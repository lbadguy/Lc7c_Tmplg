# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

## Scenario: External QR URL Actions

### 1. Scope / Trigger

- Trigger: decoded QR text controls a browser tab or an installed desktop client.
- Treat decoded content as untrusted input even when it parses as a URL.

### 2. Signatures

```js
classifyUrl(value) => {
  text,
  isUrl,
  url,
  openMode,
  openUrl,
  openLabel,
  notice
}
```

### 3. Contracts

- `openMode: "web"` permits only `http:` and `https:` in a new tab.
- `openMode: "wechat-follow"` matches only `weixin.qq.com/r/...`; it may launch
  the fixed `weixin://dl/officialaccounts` entry, but must state that the QR
  token cannot be converted into a public-account page.
- `openMode: "wechat-scheme"` permits only the official
  `weixin://dl/business/` mini-program prefix.
- Any other custom scheme returns `openMode: null` and has no executable action.

### 4. Validation & Error Matrix

- `javascript:`, `data:`, unknown `weixin:` -> inert text result.
- Popup blocked for a web URL -> keep the result visible and show a notice.
- WeChat protocol unavailable -> browser may ignore the launch; never claim that
  the target account was opened.

### 5. Good / Base / Bad Cases

- Good: `https://example.com` -> `web`.
- Base: `http://weixin.qq.com/r/token` -> `wechat-follow` with limitation notice.
- Good: `weixin://dl/business/?appid=...` -> `wechat-scheme`.
- Bad: `weixin://evil/action` or `javascript:...` -> no open action.

### 6. Tests Required

- Assert the full web action projection.
- Assert WeChat follow-token classification and fixed launch target.
- Assert the mini-program allowlist and unknown-scheme rejection.

### 7. Wrong vs Correct

```js
// Wrong: every parsed URL becomes executable.
window.location.href = decodedText;

// Correct: execute only a classified, allowlisted projection.
const result = classifyUrl(decodedText);
if (result.openUrl) executeAction(result.openMode, result.openUrl);
```
