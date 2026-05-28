# Privacy Policy — Lội Thớt Hộ

**Effective date:** 2026-05-29

---

## 1. Overview

Lội Thớt Hộ ("the Extension") is a browser extension that reads forum thread content on **voz.vn** and **otofun.net**, analyzes it using a large language model (LLM) API key supplied by the user, and displays the results in a local side panel. All processing happens on the user's device or is sent directly from the user's browser to the LLM provider of their choice. The developer does not operate any server, does not receive any user data, and has no access to any information processed by the Extension.

---

## 2. Data Collected and How It Is Used

### 2.1 Forum content

When the user opens the Extension's side panel on a supported forum thread, the Extension reads the following data directly from the page DOM:

- Post text content
- Post author usernames
- Post timestamps and post numbers
- User profile metadata visible on the page (join date, post count, reaction score, user title/rank)
- Thread title and URL

**How it is used:** This data is assembled into a prompt and sent from the user's browser to the LLM provider configured by the user (see Section 3) to generate a summary and opinion analysis. It is also cached locally in the browser's IndexedDB so the user can revisit past analyses without re-processing.

### 2.2 LLM API key and provider settings

The user's LLM API key, chosen provider, and related configuration (model name, base URL) are stored locally in `chrome.storage` on the user's device.

**How it is used:** The API key is included in requests sent directly from the browser to the user's chosen LLM provider. It is never transmitted to any server operated by the developer.

### 2.3 Saved analyses and notebooks

Summaries, opinion groupings, and notebook entries created by the Extension are stored locally in the browser's IndexedDB.

**How it is used:** Persisted solely for the user's own reference within the Extension. No data is synced or uploaded anywhere.

---

## 3. Data Sharing

The Extension does not share user data with the developer or any third party operated by the developer.

Forum post content is transmitted **directly from the user's browser** to the LLM provider selected by the user. The following providers are supported:

| Provider | Privacy policy |
|---|---|
| OpenAI (api.openai.com) | https://openai.com/policies/privacy-policy |
| Anthropic Claude (api.anthropic.com) | https://www.anthropic.com/privacy |
| Google Gemini (generativelanguage.googleapis.com) | https://policies.google.com/privacy |
| OpenRouter (openrouter.ai) | https://openrouter.ai/privacy |
| Custom / self-hosted endpoint (user-defined) | Governed by the endpoint operator's own policy |

The user is responsible for reviewing the privacy policy of their chosen provider. The Extension only contacts the provider endpoint that the user explicitly configures.

No other third-party services receive any data from the Extension.

---

## 4. Data Retention and Deletion

All data stored by the Extension (cached analyses, notebook entries, settings) resides in the user's browser and is never transmitted to the developer. The user can delete all stored data at any time by:

- Removing individual entries within the Extension's side panel, or
- Uninstalling the Extension, which removes all associated `chrome.storage` and IndexedDB data from the browser.

---

## 5. Permissions Explained

| Permission | Reason |
|---|---|
| `activeTab` | Required to securely read the text content of the currently active forum thread only when the user explicitly interacts with the extension. This ensures strict user privacy by avoiding permanent host permissions across all websites. |
| `sidePanel` | Required to host the main extension interface alongside the active browser tab. This allows users to read summaries, analyze forum factions, and manage their notebook seamlessly without leaving or disrupting their current reading flow. |
| `storage` | Required to store the user-configured LLM API keys, cached thread summaries, and persist the user's saved knowledge entries inside the local browser storage (IndexedDB) for offline retrieval. |
| Host access: `voz.vn`, `otofun.net` | voz.vn and otofun.net are Vietnamese XenForo-based forums. The content script runs exclusively on these two domains to read the visible thread HTML (post text, author name, timestamp, post number, and user metadata such as join date and reaction score) when the user actively opens the extension's side panel. This data is passed locally to the side panel, where it is sent to an LLM provider (OpenAI, Google Gemini, or Anthropic Claude) using an API key supplied by the user. No data is transmitted to any server owned or operated by the extension developer. All saved results (summaries, notebooks) are stored in the browser's local IndexedDB and never leave the user's device. Access is intentionally limited to these two domains. No other sites are matched. The content script is passive. It does not modify the DOM, inject UI, or run any logic until it receives a DETECT_XF message from the side panel triggered by user action. |

---

## 6. Children's Privacy

The Extension is not directed at children under 13. It does not knowingly collect personal information from children.

---

## 7. Changes to This Policy

If this policy is updated, the new version will be published in this file with a revised effective date. Continued use of the Extension after changes are posted constitutes acceptance of the updated policy.

---

## 8. Contact

For questions about this privacy policy, open an issue on the project repository.
