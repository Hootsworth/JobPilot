import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: 'automatic'
    }
  }),
  manifest: {
    name: 'JobPilot — AI Application Assistant',
    version: '0.1.0',
    description:
      'Detects Greenhouse, Lever, and Ashby application forms, autofills from your JobPilot profile and tailored resume, and pauses for your review before submit.',
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
    host_permissions: [
      'https://boards.greenhouse.io/*',
      'https://job-boards.greenhouse.io/*',
      'https://boards.eu.greenhouse.io/*',
      'https://job-boards.eu.greenhouse.io/*',
      'https://jobs.lever.co/*',
      'https://jobs.eu.lever.co/*',
      'https://jobs.ashbyhq.com/*',
      'http://localhost:4000/*',
      'https://*.onrender.com/*'
    ],
    optional_host_permissions: [
      'https://*.myworkdayjobs.com/*',
      'https://*.myworkdaysite.com/*',
      'https://*.naukri.com/*',
      'https://*.foundit.in/*',
      'https://*.internshala.com/*',
      'https://*.instahyre.com/*',
      'https://*.wellfound.com/*',
      'https://*.angel.co/*',
      'https://*.linkedin.com/*',
      'https://*/*'
    ]
  }
});
