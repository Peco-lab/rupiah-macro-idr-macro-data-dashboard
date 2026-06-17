# rupiah-macro

An open-source macro dashboard for tracking:

- IDR/USD
- BI rate
- IHSG
- Inflation

## What's in this first version

- A polished single-page dashboard
- An Electron desktop shell that opens the app in its own window
- Sample macro series and snapshot cards
- A plain JavaScript chart renderer with no build step
- A clean data-adapter path for plugging in safer mirror feeds and stable public sources

## How to use

Run `npm start` to launch the Electron app, or open `index.html` in a browser for the standalone web version.

## Data

The repo currently ships with sample data in [`data/dashboard.json`](./data/dashboard.json).

The UI is structured so you can replace that file or swap in a live fetch layer without changing the dashboard layout.

## Next integration step

Wire the data layer to safer production sources:

- Inflation from BPS packages
- USD/IDR and IHSG from trusted market-data mirrors such as Yahoo Finance
- BI rate from a maintained policy-rate source or a curated reference table

That keeps the project usable today while avoiding brittle direct BI web-service dependencies.
