# Channels and series are distinct

## Status

Accepted. Series live under the channel's `series/` folder (layout 2, [workspace contract](../workspace)).

## Decision

A channel owns publication identity, audience, brand, and platform defaults, while a series owns the conventions of one recurring format within that channel. Episodes belong to exactly one series, and configuration inherits from system defaults through channel and series to episode; initialization may create a default channel to keep single-series use simple.
