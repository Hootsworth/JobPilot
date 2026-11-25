import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: 'automatic'
    }
  }),
  manifest: () => ({
    name: 'JobPilot — AI Application Assistant',
    version: '0.1.0',
    description:
      'Adds "Autofill via JobPilot" beside Apply buttons and in the side panel on any website, filling fields with AI and asking only required missing questions.',
    action: {
      default_title: 'Open JobPilot Autofill Review',
      default_icon: {
        '16': 'icon/icon-16.png',
        '32': 'icon/icon-32.png',
        '48': 'icon/icon-48.png',
        '128': 'icon/icon-128.png'
      }
    },
    icons: {
      '16': 'icon/icon-16.png',
      '32': 'icon/icon-32.png',
      '48': 'icon/icon-48.png',
      '128': 'icon/icon-128.png'
    },
    permissions: ['storage', 'tabs', 'activeTab', 'sidePanel', 'contextMenus', 'scripting'],
    commands: {
      'save-current-job': {
        suggested_key: {
          default: 'Alt+Shift+S',
          mac: 'Alt+Shift+S'
        },
        description: 'Save current page job to JobPilot Tracker'
      }
    },
    host_permissions: ['https://*/*', 'http://*/*']
  })
});
