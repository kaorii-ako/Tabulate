import type { ClusterResponse, GroupResponse } from '../lib/types'

const tabCountEl = document.getElementById('tab-count')!
const clusterCountEl = document.getElementById('cluster-count')!
const clusterBtn = document.getElementById('cluster-btn') as HTMLButtonElement
const groupBtn = document.getElementById('group-btn') as HTMLButtonElement
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement
const statusEl = document.getElementById('status')!

const OWN_ORIGIN = chrome.runtime.getURL('')

async function loadStats() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const openTabs = tabs.filter((t) => !(t.url || '').startsWith(OWN_ORIGIN))
    tabCountEl.textContent = String(openTabs.length)

    const { lastClustering } = await chrome.storage.local.get('lastClustering')
    if (lastClustering?.clusters?.length) {
      clusterCountEl.textContent = String(lastClustering.clusters.length)
      groupBtn.disabled = false
    } else {
      clusterCountEl.textContent = '0'
      groupBtn.disabled = true
    }
  } catch {
    tabCountEl.textContent = '?'
  }
}

function showStatus(msg: string, kind: 'success' | 'error' | 'loading') {
  statusEl.textContent = msg
  statusEl.className = `status ${kind}`
  if (kind !== 'loading') {
    setTimeout(() => {
      statusEl.className = 'status hidden'
    }, 3000)
  }
}

async function quickCluster() {
  clusterBtn.classList.add('loading')
  showStatus('Clustering your tabs...', 'loading')

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'CLUSTER',
      force: true,
    })) as ClusterResponse

    if (res.ok) {
      const count = res.result.clusters.length
      showStatus(`Created ${count} cluster${count === 1 ? '' : 's'}`, 'success')
      clusterCountEl.textContent = String(count)
    } else {
      showStatus(res.error, 'error')
    }
  } catch (err: any) {
    showStatus(err?.message || 'Failed to cluster', 'error')
  } finally {
    clusterBtn.classList.remove('loading')
  }
}

async function groupTabs() {
  groupBtn.classList.add('loading')
  showStatus('Grouping tabs...', 'loading')

  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GROUP' })) as GroupResponse

    if (res.ok) {
      const { groups, tabs } = res.result
      showStatus(
        `Grouped ${tabs} tab${tabs === 1 ? '' : 's'} into ${groups} group${groups === 1 ? '' : 's'}`,
        'success',
      )
    } else {
      showStatus(res.error, 'error')
    }
  } catch (err: any) {
    showStatus(err?.message || 'Failed to group', 'error')
  } finally {
    groupBtn.classList.remove('loading')
  }
}

function openSettings() {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html')
  chrome.tabs.create({ url: `${dashboardUrl}#settings` })
  window.close()
}

clusterBtn.addEventListener('click', quickCluster)
groupBtn.addEventListener('click', groupTabs)
settingsBtn.addEventListener('click', openSettings)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
  if (e.key === '1') quickCluster()
  if (e.key === '2' && !groupBtn.disabled) groupTabs()
  if (e.key === '3') openSettings()
})

loadStats()
