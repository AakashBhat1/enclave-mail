# EnclaveMail (Desktop Email Client)

A modern, privacy-first, 100% free desktop email client (Thunderbird alternative) built with **Electron + TypeScript + Vite + TailwindCSS + SQLite (FTS5)**.

---

## Key Features

1. **Strict Provider Enclaves:**
   - Multi-account without the mess. Each email provider has its own dedicated workspace and isolated local SQLite database. No cross-account data leakage.
2. **Two-Way Communication:**
   - Full inbound sync via **IMAP (`imapflow`)** with push notifications.
   - Outbound email dispatch via **SMTP (`nodemailer`)** over encrypted TLS.
3. **Safe Sandboxed Reader:**
   - Strips malicious JavaScript with DOMPurify.
   - Blocks tracking pixels and remote beacons by default.
4. **Local Modding & Automation Engine:**
   - Script custom rules in `mods/` (auto-filing receipts, Markdown export, custom tags).
   - Runs 100% on your laptop with zero inbound network exposure.

---

## Project Structure

```text
c:\dev\brainstorm\self-coded-mail-client\
├── docs/                                  <-- Ideation logs, specs, and threat models
│   ├── overview.md                        <-- Topic overview and session index
│   ├── session_01_....md                  <-- Feasibility & MUA vs MTA
│   ├── session_02_....md                  <-- Provider Enclave Architecture
│   ├── session_03_....md                  <-- Tech Stack & Security Threat Model
│   └── session_04_....md                  <-- Desktop .exe & Outbound SMTP Security
├── mods/                                  <-- User automation scripts (auto_invoice_filer.js)
├── src/
│   ├── main/                              <-- Electron Main Process (Node backend)
│   │   ├── index.ts                       <-- App lifecycle & IPC dispatch
│   │   ├── preload.ts                     <-- Secure IPC context bridge
│   │   └── engine/
│   │       ├── storage-service.ts         <-- Isolated SQLite / JSON persistence
│   │       ├── mod-engine.ts              <-- User automation & rule runner
│   │       ├── smtp-service.ts            <-- Outbound TLS email sender
│   │       └── imap-service.ts            <-- Inbound IMAP connector
│   └── renderer/                          <-- React + Tailwind Desktop UI
│       ├── App.tsx                        <-- 3-pane layout & workspace orchestrator
│       ├── components/
│       │   ├── WorkspaceDock.tsx          <-- Provider enclave icons (Discord-style)
│       │   ├── FolderTree.tsx             <-- Folders & enclave status
│       │   ├── MessageList.tsx            <-- Thread list with search & filter chips
│       │   ├── ReadingPane.tsx            <-- Sandboxed email reader & security badges
│       │   ├── ComposerModal.tsx          <-- Email composer (To, Subject, Body, Send)
│       │   ├── ModManagerModal.tsx        <-- Mod & automation rule manager
│       │   └── AddAccountModal.tsx        <-- Add new provider enclave
│       └── types/
│           └── index.ts                   <-- Data models
├── package.json
└── vite.config.ts
```

---

## How to Run

### Development Mode (with hot-reload):
```bash
npm run dev
```

### Production Build:
```bash
npm run build
```
