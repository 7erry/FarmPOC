# Cursor prompt

This is the prompt that was supplied to create the FarmENGAGE Atlas PoC.

---

# Proof of Concept (PoC) Guide: FarmENGAGE Integration & Architecture

**Objective:** Examine the API docs at [https://api-docs.farmengage.com/](https://api-docs.farmengage.com/) and build a PoC on MongoDB Atlas leveraging **Time Series**, **Geospatial**, **Search**, and **Vector Search**. 

This PoC for AGCO / PTx Trimble FarmENGAGE demonstrates how the platform unifies mixed-fleet telemetry, manages field tasks, and bidirectionally syncs guidance/prescription data between office software and in-cab displays (e.g., GFX displays or AGCO terminals). 

This guide outlines the architecture, setup sequence, and code prototype to build your PoC.

---

## 1. PoC Architecture Overview

```text
[ In-Cab Terminals / Mixed Fleet ] ──(ISO 11783 / ISO-XML)──┐
                                                             │
[ Third-Party APIs (John Deere, Raven) ] ──(REST / OIDC)───► [ FarmENGAGE Integration Gateway / PoC Service ]
                                                             ▲
[ Web Dashboard / ERP / FMIS ] ─────────(JSON / GeoJSON)─────┘
```

The PoC validates three primary capabilities:
* **Field & Work Order Management:** Creating and assigning work orders (field boundary, guidance line, rate prescription).
* **Fleet Telemetry Aggregation:** Ingesting live machine location, speed, and active field tasks across mixed OEMs.
* **Automated Sync (Direct Send / AutoSync):** Pushing ISO-XML tasks to equipment displays without manual USB transfers.

---

## 2. Step-by-Step Implementation Sequence

### 1. Environment & Credentials Setup
* **Prerequisites:** Obtain API developer credentials and register your application with the PTx Trimble / FarmENGAGE Developer Portal. Ensure OAuth 2.0 / OIDC credentials (Client ID, Client Secret, Redirect URI) are properly configured.

### 2. Define Data Schema & Boundaries
* **GeoJSON / ISO-XML:** Prepare test data containing field geometries (GeoJSON/WKT), guidance lines (AB-lines), and operational parameters (target seed rates or spray volumes).

### 3. Build Mock Telemetry & Task Sync Ingestion
* **Backend Gateway:** Deploy a lightweight Python/Node.js backend service that consumes simulated machine telemetry feeds and triggers task synchronization events via HTTP endpoints.

### 4. Develop Interactive PoC Dashboard
* **Frontend UI:** Build a streamlined interface to visualize live machine locations on a map, create work orders, and display completion progress in real time.
