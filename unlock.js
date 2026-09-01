const config = JSON.parse(document.querySelector("#vault-config").textContent);
const form = document.querySelector("#unlock-form");
const passwordInput = document.querySelector("#password");
const errorNode = document.querySelector("#password-error");
const submit = document.querySelector(".submit");
const reveal = document.querySelector(".reveal");
const scopeUrl = new URL("./", window.location.href);
const appUrl = new URL("app/yalken-primary/index.html", scopeUrl);
appUrl.search = window.location.search;
appUrl.hash = window.location.hash;

function hexBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

async function workerTarget() {
  if (!("serviceWorker" in navigator) || !window.crypto?.subtle) throw new Error("unsupported");
  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 1800);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  return navigator.serviceWorker.controller || registration.active;
}

function askWorker(worker, payload) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("worker-timeout")), 15000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      event.data?.ok ? resolve(event.data) : reject(new Error(event.data?.error || "worker-error"));
    };
    worker.postMessage(payload, [channel.port2]);
  });
}

async function deriveKey(password) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: hexBytes(config.salt), iterations: config.iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function unlock(password) {
  const [worker, encrypted] = await Promise.all([
    workerTarget(),
    fetch(new URL(config.vault, scopeUrl), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("vault-unavailable");
      return response.arrayBuffer();
    }),
  ]);
  const key = await deriveKey(password);
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: hexBytes(config.iv),
      additionalData: new TextEncoder().encode(config.format),
      tagLength: 128,
    },
    key,
    encrypted,
  );
  const payload = JSON.parse(new TextDecoder().decode(clear));
  if (payload.format !== config.format || !payload.assets) throw new Error("vault-invalid");
  await askWorker(worker, { type: "unlock", assets: payload.assets });
}

reveal.addEventListener("click", () => {
  const visible = passwordInput.type === "text";
  passwordInput.type = visible ? "password" : "text";
  reveal.textContent = visible ? "Показать" : "Скрыть";
  reveal.setAttribute("aria-label", visible ? "Показать пароль" : "Скрыть пароль");
  passwordInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorNode.textContent = "";
  passwordInput.setAttribute("aria-invalid", "false");
  submit.disabled = true;
  submit.textContent = "Открываю…";
  try {
    await unlock(passwordInput.value);
    passwordInput.value = "";
    window.location.replace(appUrl);
  } catch (error) {
    const unsupported = error.message === "unsupported";
    errorNode.textContent = unsupported
      ? "Этот браузер не поддерживает защищённый режим. Обнови Safari или открой ссылку в Chrome."
      : "Пароль не подошёл или контейнер не загрузился. Попробуй ещё раз.";
    passwordInput.setAttribute("aria-invalid", "true");
    passwordInput.focus();
    submit.disabled = false;
    submit.textContent = "Открыть Atlas";
  }
});

(async () => {
  try {
    const worker = await workerTarget();
    const status = await askWorker(worker, { type: "status" });
    if (status.unlocked) window.location.replace(appUrl);
  } catch {
    // The form remains usable and reports a concrete error on submit.
  }
})();
