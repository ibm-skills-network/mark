````mermaid
flowchart TD
    %% Main flow
    Start([Author Login]) --> A1[Author Dashboard]
    A1 --> A2[Question Management]
    A2 --> A3[Create/Edit Questions]
    A3 --> A4[File Manager]
    
    %% File Management System
    A4 --> F1[File Explorer]
    F1 --> FileOpsGroup
    
    subgraph FileOpsGroup [File Operations]
        direction TB
        F2[View Files & Folders]
        F3[Upload Files]
        F4[Create Folders]
        F5[Delete Files/Folders]
        F6[Rename Files]
        F7[Move Files]
        F8[Preview Files]
        F9[Select Files for Questions]
    end
    
    %% Connect to backend
    FileOpsGroup --> B1[API Routes]
    
    %% Backend flow
    B1 --> B2[File Operations Handler]
    B2 --> B3[IBM Cloud Object Storage]
    B1 --> B4[Database Operations]
    
    %% Storage details
    B3 --> S1[(Author Bucket)]
    B3 -.-> S2[(Learner Bucket)]
    B3 -.-> S3[(Debug Bucket)]
    
    %% Database operations
    B4 --> B5[File Metadata Storage]
    B4 --> B6[Question-File Associations]
    
    %% Complete flow
    B5 --> Complete([File Management Complete])
    B6 --> Complete
    
    %% Styling
    classDef primary fill:#d4f1f9,stroke:#05728f,stroke-width:2px,color:#05728f,font-weight:bold
    classDef secondary fill:#ffe6cc,stroke:#d79b00,stroke-width:2px,color:#d79b00
    classDef tertiary fill:#e1d5e7,stroke:#9673a6,stroke-width:2px,color:#9673a6
    classDef storage fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px,color:#6c8ebf
    classDef endpoint fill:#d5e8d4,stroke:#82b366,stroke-width:2px,color:#82b366,font-weight:bold,border-radius:10px
    
    class Start,Complete endpoint
    class A1,A2,A3,A4 primary
    class F1,FileOpsGroup secondary
    class B1,B2,B3,B4,B5,B6 tertiary
    class S1,S2,S3 storage

````