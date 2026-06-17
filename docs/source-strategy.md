# Source Strategy

This project intentionally avoids depending on brittle direct BI legacy web-service calls for production.

Recommended production sources:

- Inflation: BPS packages or other official statistics distributions
- USD/IDR: trusted market-data mirrors such as Yahoo Finance
- IHSG: trusted market-data mirrors such as Yahoo Finance
- BI rate: curated reference table or a stable maintained feed

The dashboard UI should stay source-agnostic. Swap the adapter layer, not the presentation layer.
