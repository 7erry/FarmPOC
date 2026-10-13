# FarmENGAGE Atlas PoC

A local gateway and map that store [FarmENGAGE Data API](https://api-docs.farmengage.com/) shaped fields, guidance lines, prescriptions, and work orders in MongoDB Atlas. Live machine positions are simulated. The public spec has no telemetry stream and no OAuth scheme, so this process does not call `https://api.farmengage.com`.

Atlas features in play:

- [Time series](https://www.mongodb.com/docs/manual/core/timeseries-collections/) collection `telemetry` (speed and position samples)
- [2dsphere](https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/2dsphere/) indexes on field boundaries, guidance lines, and current fleet positions
- [Atlas Search](https://www.mongodb.com/docs/atlas/atlas-search/atlas-search-overview/) on work orders
- [Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/) on short job notes, embedded with [voyage-4](https://www.mongodb.com/docs/voyageai/models/text-embeddings/) (1024 dimensions, cosine)

The page header links the same docs. The download icon under the title fetches `/source.zip`, which is this source tree plus `CURSOR_PROMPT.md`. The [Node.js driver](https://www.mongodb.com/docs/drivers/node/current/) talks to Atlas.

Display send follows `PUT /operations/{orgId}/workorders/{workOrderId}/vehicletarget/{vehicleId}`. The stored XML is a short TASKDATA fragment, not a full ISO 11783 file. John Deere and Raven machines are simulated labels.

## How it works

The demo org is Ames Demo Farm: two fields (North 40, corn; South Field, soybeans), AB guidance lines, a rate prescription, and a mixed fleet. `npm run seed` loads that into the existing M0 cluster and waits until Search and Vector Search answer a probe. `npm start` serves the page at `http://127.0.0.1:8787` and starts the simulator.

Each second the simulator writes speed and position into `telemetry` and updates the current pose in `fleetState`. The page shows a 3-minute average speed and a sparkline. Field boundaries, guidance lines, and live positions have `2dsphere` indexes. The snapshot counts machines inside each boundary with `$geoWithin`.

Keyword search covers work order name, comments, operation type, and material, filtered to this org. Comments on a new work order are embedded with [voyage-4](https://www.mongodb.com/docs/api/doc/atlas-embedding-and-reranking-api/operation/operation-createembedding) (1024 dimensions, cosine) and stored in `notes`. Similar-work search embeds the query the same way and runs `$vectorSearch`.

The map (MapLibre) draws field polygons, rate zones, AB lines, and machine markers. The side panel creates a work order (Plant, Fertilize, Spray, or Harvest) and sends it to a vehicle. That send stores the TASKDATA fragment in `syncJobs`. As the assigned machine drives the field, the simulator walks the cab status from pending through acknowledged and in progress to done, and raises the work order’s covered fraction until the job is complete.

## Run

Sign up and create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register). Copy the `mongodb+srv` connection string into `MONGODB_URI`. Create an [Atlas model API key](https://www.mongodb.com/docs/voyageai/management/api-keys) and set `VOYAGE_API_KEY`. That key calls [voyage-4](https://www.mongodb.com/docs/voyageai/models/text-embeddings/) at `https://ai.mongodb.com/v1/embeddings`. Then run the commands below.

```bash
npm install
npm test
export MONGODB_URI='mongodb+srv://USER:PASSWORD@myfreecluster.5thctns.mongodb.net/'
export VOYAGE_API_KEY='your-atlas-model-api-key'
npm run seed
npm start
```

Open http://127.0.0.1:8787

`npm run seed` loads the Ames, Iowa demo farm and waits until Search and Vector Search answer a probe. The cluster in use is the existing M0 `MyFreeCluster`. Keep the sample small; that tier is not a place for historical fleet telemetry.

## What the page shows

- Field polygons, rate zones, AB lines, and machine markers
- How many machines `$geoWithin` finds inside each boundary
- A 3-minute speed average from the time series collection
- Create a work order and send it to a TaskDoc-style device
- Keyword search and similar-job search

## Screenshots

![Ames demo farm map with field polygons, guidance lines, and machine markers](docs/screenshots/map.png)

The map at `/` after tiles, field boundaries, and the live fleet have loaded.

![Architecture diagram of the gateway, simulator, and Atlas collections](docs/screenshots/architecture.png)

The diagram at `/architecture`, served from `.archify`.
