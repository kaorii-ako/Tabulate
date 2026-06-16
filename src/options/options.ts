const keyInput = document.getElementById('key') as HTMLInputElement
const saveBtn = document.getElementById('save') as HTMLButtonElement
const clearBtn = document.getElementById('clear') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLSpanElement

let statusTimer: number | undefined

function flash(text: string) {
  statusEl.textContent = text
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    statusEl.textContent = ''
  }, 2000)
}

async function load() {
  const { apiKey } = await chrome.storage.local.get('apiKey')
  if (typeof apiKey === 'string') keyInput.value = apiKey
}

saveBtn.onclick = async () => {
  const apiKey = keyInput.value.trim()
  await chrome.storage.local.set({ apiKey })
  await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
  flash('Saved')
}

clearBtn.onclick = async () => {
  keyInput.value = ''
  await chrome.storage.local.remove('apiKey')
  await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
  flash('Cleared')
}

void load()
