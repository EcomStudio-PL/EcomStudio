# Models

`ai_models` per row: identifier, provider, active, credit pricing per
resolution (pricing json + credit_cost base), supported resolutions/ratios,
ecom_surcharge_credits (added when GrovBase writes the prompt),
internal_cost_usd_micros (admin-maintained real per-image provider cost —
recorded on every usage event for margin truth), fallback ids.
Admin manages the catalog; users never see provider names, only model cards.
