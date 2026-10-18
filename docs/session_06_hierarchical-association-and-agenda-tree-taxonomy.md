> **Links:** [[../../Welcome|Project root]] | [[overview|Topic Overview]] | [[../../../Style DNA|Style DNA]] | [[../../../../Welcome|Vault index]]
> **Session Chain:** [[session_01_feasibility-and-architecture-breakdown|Session 01]] -> [[session_02_provider-isolation-and-moddable-architecture|Session 02]] -> [[session_03_tech-stack-selection-and-security-threat-model|Session 03]] -> [[session_04_desktop-app-architecture-and-outbound-smtp-security|Session 04]] -> [[session_05_voice-driven-navigation-and-local-whisper-integration|Session 05]] -> **Session 06 (Current)**

# Session 06: Hierarchical Association and Agenda Tree Taxonomy

**Topic:** [[overview|Self Coded Mail Client]]  
**Date:** 2026-10-18 00:22  
**Participants:** User, AI Assistant  
**Focus:** Architecting a multi-level hierarchical tree organizing emails by Account -> Association -> Agenda (Projects, Financials) with drag-and-drop custom positioning.  

---

## 1. Executive Summary & Breakthroughs
- **The Core User Realization:** Organizing emails merely by folders or search keywords like "7brd" was only a stepping stone. Real-world email workflows require a **Multi-Level Hierarchical Tree Taxonomy**:
  1. **Account / Enclave:** The top-level account (Personal, Work, Consulting).
  2. **Association (Entities / Counterparties):** The client, vendor, project team, or organization (e.g., *7brd Core*, *Acme Corp*, *Stripe*, *AWS*). An association can encompass multiple email addresses and senders.
  3. **Agenda (Functional Context):** The functional purpose of the email (e.g., *Project*, *Financial*, *Legal*, *Operations*).
  4. **Sub-Agenda / Intersection (e.g. "Project Financial"):** Specific sub-facets like project budgets, milestone deliverables, or invoice reconciliations.
- **Custom Spatial Positioning:** Users must be able to define **custom tree positions** (drag-and-drop ordering, pinning priority associations to the top) rather than being trapped in a rigid reverse-chronological list.

---

## 2. Spoken Conversation & Dialogue Transcript

### User
> "So see 7brd was just an example. In future I would be adding multiple accounts, and each account would have multiple new mails each associated with an association, and one association could have more than one mail. I should be able to set custom positions to move these mails. And also each mail, even though being of an association, there is then an agenda on top of that—like a project, or financial, or a project financial. So then I should be able to set it according to that also, and it should be basically like a tree."

### Assistant
> "You have just articulated the ultimate email organization model that neither Thunderbird, Outlook, nor Gmail has ever solved:
> 
> 1. **The Limitation of Traditional Folders & Labels:**
>    - Folders are rigid silos (an email can only be in one folder).
>    - Gmail labels are flat, unorganized lists that quickly turn into chaotic tag soups.
> 
> 2. **Your Hierarchical Tree Solution (Account → Association → Agenda):**
>    - **Account:** The root mailbox (Work, Personal, Studio).
>    - **Association:** The entity/company/partner (e.g. *7brd Team*, *Client X*, *Cloud Vendor*).
>    - **Agenda:** The operational domain (*Project*, *Financial*, *Roadmap*).
>    - **Composite Nodes (*Project Financial*):** Emails that cross boundaries—for example, an invoice specifically tied to Milestone 2 of Project Alpha.
> 
> 3. **Custom Tree Positioning:**
>    - Instead of being forced into date-sorted order, each node and branch in your tree has an explicit **position index**. You can drag high-priority client associations to the very top, collapse background vendors, and organize your inbox like a structured outline or mind-map."

---

## 3. Core Concepts & Ideation Details

### 3.1 The Hierarchical Association-Agenda Tree (HAAT) Model

```mermaid
flowchart TD
    subgraph Account["Account Enclave (e.g. Work Mail)"]
        TreeRoot["Custom Tree Root"]
        
        subgraph Assoc1["Association: 7brd Project"]
            A1_General["Agenda: General / Roadmap"]
            A1_Project["Agenda: Project Dev"]
            A1_Financial["Agenda: Project Financial (SOW & Invoices)"]
        end

        subgraph Assoc2["Association: Acme Corp (Client)"]
            A2_Legal["Agenda: Contracts & Legal"]
            A2_Financial["Agenda: Billing & Escrow"]
            A2_Project["Agenda: Sprint Reviews"]
        end

        subgraph Assoc3["Association: Cloud Infrastructure (AWS / Stripe)"]
            A3_Ops["Agenda: System Alerts"]
            A3_Financial["Agenda: Monthly Statements"]
        end
        
        TreeRoot --> Assoc1
        TreeRoot --> Assoc2
        TreeRoot --> Assoc3
        
        Assoc1 --> A1_General
        Assoc1 --> A1_Project
        Assoc1 --> A1_Financial
        
        Assoc2 --> A2_Legal
        Assoc2 --> A2_Financial
        Assoc2 --> A2_Project
        
        Assoc3 --> A3_Ops
        Assoc3 --> A3_Financial
    end
```

### 3.2 Dual-Axis Navigation (Association vs Agenda Lenses)

Because emails have both an **Association** and an **Agenda**, the UI can provide two distinct lenses:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [LENS TOGGLE]:  (•) By Association (Entities)     ( ) By Agenda (Functional Matrix)    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 🏢 ACME CORP (Position #1)                      │  • [Milestone 2 Signoff]           │
│    ├── 📁 General Communications                  │    Elena Rostova • 2:15 PM         │
│    ├── 📁 Project Development                     │    Agenda: Project                 │
│    └── 💰 Project Financial (2 unread)           │                                    │
│                                                   │  • [Invoice #1042 - Sprint Budget] │
│ ▼ 🚀 7BRD TEAM (Position #2)                      │    Billing • 11:30 AM              │
│    ├── 📁 Architecture & RFCs                     │    Agenda: Project Financial       │
│    ├── 📁 Voice Integration Sprint                │                                    │
│    └── 💰 Financial Grants                        │                                    │
│                                                   │                                    │
│ ▼ ☁️ CLOUD INFRASTRUCTURE (Position #3)           │                                    │
│    └── 💰 Financial Receipts                      │                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

When switching to the **Agenda Lens**:
* View **All Financials** across all Associations in one consolidated ledger view.
* View **All Active Projects** across all clients simultaneously.

### 3.3 Data Model Architecture

```typescript
export interface AssociationNode {
  id: string;
  providerId: string;
  name: string;             // e.g. "Acme Corp", "7brd", "Stripe"
  icon?: string;
  position: number;          // Custom user-defined sort order
  matchingRules: {
    domains: string[];       // e.g. ["@acmecorp.io", "@acme.com"]
    senders: string[];       // e.g. ["releases@7brd.io"]
    keywords: string[];      // e.g. ["#7brd", "Acme"]
  };
  agendas: AgendaNode[];     // Nested tree branches
}

export interface AgendaNode {
  id: string;
  name: string;             // e.g. "Project", "Financial", "Project Financial"
  category: 'project' | 'financial' | 'operations' | 'legal' | 'custom';
  position: number;          // Custom position within association
  unreadCount: number;
  totalCount: number;
}

export interface TreeClassifiedEmail {
  emailId: string;
  associationId: string;
  agendaId: string;
  positionRank: number;     // Custom manual ordering of emails within the node
}
```

### 3.4 Custom Spatial Ordering & Drag-and-Drop
- Every node in the hierarchy contains an explicit `position` integer.
- The UI exposes drag handles (`⠿`) allowing users to:
  - Drag an Association up or down to re-rank priority.
  - Drag an Agenda into another Agenda (creating sub-agendas like `Project Financial`).
  - Drag individual emails into an Association or Agenda node to manually re-classify and set custom positions.

---

## 4. Compound Voice Command Integration (Extending Session 05)
With the tree structure established, the on-device voice engine can parse compound utterances:
* *"Show 7brd Financial"* → Drills down directly to `7brd` → `Financial`.
* *"Show Acme Project"* → Drills down directly to `Acme Corp` → `Project Development`.
* *"Move to Financial"* → Reclassifies the active email into the Financial agenda of its association.

---

## 5. Decisions Made & Action Items
- [x] Defined the 3-tier hierarchy: **Account → Association → Agenda / Sub-Agenda**.
- [x] Designed custom positional ordering allowing manual re-ordering and drag-and-drop.
- [x] Designed dual-lens navigation (View by Association vs View by Agenda).
- [ ] Extend TypeScript data types in `src/renderer/types/index.ts` with `AssociationNode` and `AgendaNode`.
- [ ] Implement the `AssociationTree` UI component replacing the flat folder list.
- [ ] Seed rich hierarchical mock associations (`7brd Core`, `Acme Corp`, `Stripe Billing`) with agendas (`Project`, `Financial`, `Project Financial`).

---

## 6. Context Continuity & Next Session Agenda
- **Pointers for next session:** 
  1. Build the interactive Tree component in the renderer.
  2. Implement drag-and-drop / position reordering controls.
- **Related Sessions:** [[session_01_feasibility-and-architecture-breakdown|Session 01]] through [[session_05_voice-driven-navigation-and-local-whisper-integration|Session 05]]
