> **Links:** [[../../Welcome|Project root]] | [[../../../Style DNA|Style DNA]] | [[../../../../Welcome|Vault index]]

# Topic: Self-Coded Free Mail Client (Thunderbird Alternative)

**Status:** Finalized / Building (Started: 2026-10-18 00:07)  
**Created:** 2026-10-17 20:26  
**Description:** Feasibility, architecture, and roadmap for building an open-source, completely free personal email client like Thunderbird.  

---

## High-Level Vision & Objectives
- Build a lightweight, blazingly fast, privacy-first desktop email client (MUA) that is 100% free to run and distribute.
- Provide a clean, modern alternative to legacy email clients like Mozilla Thunderbird and Apple Mail.
- **Provider Enclave Isolation:** Never jumble emails into a chaotic unified soup. Each email provider has its own physically isolated workspace, database, and view.
- **First-Class Moddability:** A hackable architecture that allows users to write simple JavaScript/Python hooks, custom filter pipelines, and tailored themes without dealing with brittle third-party add-on ecosystems.
- **Live Local Voice Navigation:** Built-in speech-to-text (Whisper/on-device) to search, filter tags (e.g. "7brd"), and navigate hands-free with zero audio leakage.
- Zero server infrastructure costs by running fully client-side and connecting directly to users' existing mailboxes via IMAP/SMTP/JMAP.

## Architectural & Technical Themes
- **MUA (Mail User Agent) Focus:** Decoupled from email delivery/hosting; acts as a client connecting to standard IMAP/SMTP servers (Gmail, Outlook, iCloud, Dovecot).
- **Native Desktop Architecture:** Packaged as an `.exe` for Windows with local file access, system tray icon, and offline operation.
- **Full Outbound Sending (SMTP):** Built-in email composer supporting attachments, rich formatting, and secure delivery via TLS-encrypted SMTP.
- **Enclave Storage Model:** Each connected provider has its own independent SQLite database (`storage/<provider_id>/cache.db`), preventing data leakage and enabling per-account backups.
- **Workspace UI Switcher:** Visual dock (similar to Discord servers or Slack workspaces) to instantly toggle between isolated provider environments.
- **Mod Engine (`mods/`):** Hook pipeline (`onReceiveEmail`, `onSendEmail`) for automated sorting, custom filing, attachment routing, and Markdown export.
- **Security Sandboxing:** Strict HTML email sanitization (DOMPurify), tracking pixel blocker, CSP rules, disabled JavaScript execution, and OS credential vault encryption.
- **Local Speech Recognition:** On-device voice input for keyword extraction and instant email filtering.

## Sessions Index
| Session | Date | Focus | Link |
|---------|------|-------|------|
| Session 06 | 2026-10-18 | Hierarchical Association and Agenda Tree Taxonomy | [[session_06_hierarchical-association-and-agenda-tree-taxonomy]] |
| Session 05 | 2026-10-18 | Voice-Driven Navigation and Local Whisper Integration | [[session_05_voice-driven-navigation-and-local-whisper-integration]] |
| Session 04 | 2026-10-17 | Desktop App Architecture and Outbound SMTP Security | [[session_04_desktop-app-architecture-and-outbound-smtp-security]] |
| Session 03 | 2026-10-17 | Tech Stack Selection and Security Threat Model | [[session_03_tech-stack-selection-and-security-threat-model]] |
| Session 02 | 2026-10-17 | Provider Isolation and Moddable Architecture | [[session_02_provider-isolation-and-moddable-architecture]] |
| Session 01 | 2026-10-17 | Feasibility and Architecture Breakdown | [[session_01_feasibility-and-architecture-breakdown]] |

## Cumulative Decisions & Takeaways
- **Feasibility:** 100% realistic to build as a desktop client (MUA). Hosting a custom MTA server is unnecessary and counterproductive for this goal.
- **Form Factor:** Fully native Windows desktop application (`.exe`), not a web browser page.
- **Two-Way Communication:** Complete support for receiving (IMAP) AND sending (SMTP over TLS).
- **Security Threat Model:** Zero inbound listening ports on receiving or sending means zero remote network attack surface. TLS encryption blocks eavesdropping and tampering.
- **Voice-Driven Navigation:** Integrated local voice-to-text recognition (Whisper / on-device speech processing) allowing hands-free filtering (e.g. speaking '7brd' immediately pulls up 7brd tagged emails) and folder switching.
- **Hierarchical Association-Agenda Tree:** Emails are organized into customizable trees (Account -> Association -> Agenda / Project / Financial) with user-defined positional rankings and drag-and-drop re-ranking.
- **Tech Stack:** Electron + TypeScript chosen for highest library maturity and easiest user automation scripts.

## Implementation Milestone
- **Brainstorm Finalized:** 2026-10-18 00:07
- **Context Location:** All ideation documents preserved in `docs/`.
- **Implementation Target:** Core codebase builds directly in `c:\dev\brainstorm\self-coded-mail-client`.
