# SDK-repository — Architecture Charts

> Repository: `appolon1908/SDK-repository`  
> Baseline branch: `main`  
> Repository-local visual architecture. Update with code, contract and deployment changes.

## 1. System context
```mermaid
flowchart LR
 A["App/service developers"] --> B["Generated SDKs / connector kits"]
 B --> R["SDK-repository<br/>Cross-platform SDK and connector monorepo"]
 R --> S["contract/codegen metadata"]
 R --> D["Middleware and product APIs"]
```

## 2. Internal component architecture
```mermaid
flowchart TB
 I["Entrypoint / API / SDK / worker"] --> P["Identity, policy, validation"]
 P --> C["Core domain / orchestration"]
 C --> S["State / configuration / persistence"]
 C --> A["Adapters / integrations"]
 A --> X["Approved dependencies"]
 C --> O["Metrics, logs, traces, audit"]
```

## 3. Critical flow
```mermaid
sequenceDiagram
 participant U as Caller
 participant B as SDK-repository
 participant P as Policy
 participant C as Core
 participant S as State
 participant X as Dependency
 U->>B: Request / event / action
 B->>P: Authenticate + validate
 P-->>B: Decision
 B->>C: Validate contracts, generate SDKs, test compatibility and publish candidate
 C->>S: Read / persist
 C->>X: Bounded integration
 X-->>C: Result / readback
 C-->>U: Normalized response
```

## 4. Deployment and promotion
```mermaid
flowchart LR
 F["Feature branch"] --> T["Tests / validation"]
 T --> PR["Pull request + review"]
 PR --> CI["CI green"]
 CI --> ST["Staging / isolated verification"]
 ST --> EX["Exact-SHA certification"]
 EX --> G{"Production approval?"}
 G -- No --> ST
 G -- Yes --> P["Production promotion"]
 P --> H["Health/readiness + rollback check"]
```

## 5. Observability and recovery
```mermaid
flowchart LR
 R["SDK-repository"] --> M["Metrics"]
 R --> L["Logs / audit"]
 R --> T["Traces / correlation"]
 M --> O["Observability stack"]
 L --> O
 T --> O
 O --> A["Dashboards / alerts"]
 R --> B["Backup / config snapshot"]
 B --> RR["Restore / rollback rehearsal"]
```

## Ownership notes
- **Role:** Cross-platform SDK and connector monorepo
- **Primary boundary:** Generated SDKs / connector kits
- **State/config:** contract/codegen metadata
- **Dependencies/consumers:** Middleware and product APIs
- Cross-repository effects must use reviewed contracts; production effects remain separately gated.
