# Brand domain register

**Pulled:** 1 Oct 2026 from the `effen-os` Supabase project · **Covers:**
227 distinct domains across 15 brands, plus 60 that can't be attributed yet.

Every website domain EFFEN has sold through, grouped by brand. Two sources:

1. **Live WooCommerce connections**: `public.integration_connections`
   (`provider = 'WooCommerce'`), which `woo-sync` pulls every 15 minutes.
   This is the source of truth for what Fullkit syncs today. The 8 main
   stores were wired on 24 Jul 2026. Glycoxil and 11 landing pages were added on
   17 Sep 2026 by the `woo-onboard` script, which is not committed to this
   repo.
2. **Fighter order history**: `private.fighter_orders_staging.domain`, the
   site each of the 223,669 imported Fighter orders came from (Jun 2023 to
   30 Jun 2026). Brands are matched by name containment
   (`supabase/migrations/20260812181411_fighter_history_import.sql`), so
   domains that don't contain the brand name are unattributed.

Not covered: Meta ad landing domains in BigQuery
(`stg_meta_ad_creatives.destination_domain`). This pull had no BigQuery
access. Marketplace and WhatsApp stores have no domain.

## Summary

| Brand | Live Woo domains | Historical-only domains | Total |
|---|---|---|---|
| Adipocyde | 6 | 1 | 7 |
| Synovil | 5 | 0 | 5 |
| Cavernosil | 3 | 0 | 3 |
| Lipidri | 2 | 0 | 2 |
| Glycoxil | 2 | 0 | 2 |
| NuroKids | 2 | 2 (likely, unmapped) | 4 |
| OFICactus | 0 | 86 (+6 likely) | 92 |
| Metaponin | 0 | 26 | 26 |
| Melasma | 0 | 10 | 10 |
| Eraxtanol | 0 | 4 | 4 |
| Morosil | 0 | 2 (+1 possible) | 3 |
| Daravex | 0 | 2 | 2 |
| Miroestro | 0 | 2 (+3 possible) | 5 |
| Makcik Kaulawa | 0 | 1 | 1 |
| TheTuneMind | 0 | 1 | 1 |
| Unattributed | — | 60 | 60 |

---

## 1. Live WooCommerce connections (20)

"Orders in Fullkit" is every order in `orders_read` for that connection,
including Fighter history matched to it.

| Brand | Market | Domain | Role | Connected | Orders in Fullkit | First order | Last order |
|---|---|---|---|---|---|---|---|
| Adipocyde | MY | `adipocyde.com` | Main store | 2026-07-24 | 29,048 | 2025-09-30 | 2026-10-01 |
| Adipocyde | MY | `adipocydehq.com` | Landing page | 2026-09-17 | 9,294 | 2026-01-15 | 2026-10-01 |
| Adipocyde | MY | `hqadipocyde.com` | Landing page | 2026-09-17 | 1,377 | 2026-01-16 | 2026-10-01 |
| Adipocyde | SG | `adipocydesg.com` | Main store | 2026-07-24 | 9,857 | 2025-10-26 | 2026-10-01 |
| Adipocyde | SG | `sgadipocydehq.com` | Landing page | 2026-09-17 | 4,187 | 2026-01-16 | 2026-10-01 |
| Adipocyde | SG | `sgadipocyde.com` | Landing page | 2026-09-17 | 553 | 2026-01-20 | 2026-10-01 |
| Cavernosil | MY | `cavernosil.com` | Main store | 2026-07-24 | 9,912 | 2026-06-19 | 2026-10-01 |
| Cavernosil | MY | `farmasilelaki.com` | Landing page | 2026-09-17 | 2,931 | 2026-06-23 | 2026-10-01 |
| Cavernosil | SG | `cavernosilsg.com` | Main store | 2026-07-24 | 2,074 | 2026-06-24 | 2026-10-01 |
| Glycoxil | MY | `glycoxil.com` | Main store | 2026-09-17 | 293 | 2026-07-28 | 2026-10-01 |
| Glycoxil | MY | `glycoxilhq.com` | Landing page | 2026-09-17 | 10 | 2026-07-28 | 2026-09-17 |
| Lipidri | MY | `lipidri.com` | Main store | 2026-07-24 | 28,905 | 2025-06-22 | 2026-10-01 |
| Lipidri | SG | `lipidrisg.com` | Main store | 2026-07-24 | 3,934 | 2025-08-11 | 2026-10-01 |
| NuroKids | MY | `farmasijunior.com` | Landing page | 2026-09-17 | 11 | 2026-05-30 | 2026-06-02 |
| NuroKids | SG | `farmasijuniorsg.com` | Landing page | 2026-09-17 | 4 | 2026-05-30 | 2026-06-03 |
| Synovil | MY | `synovil.com` | Main store | 2026-07-24 | 39,648 | 2025-08-16 | 2026-10-01 |
| Synovil | MY | `synovilhq.com` | Landing page | 2026-09-17 | 403 | 2025-11-26 | 2026-09-30 |
| Synovil | MY | `synovil.com.my` | Landing page | 2026-09-17 | 8 | 2026-06-18 | 2026-09-08 |
| Synovil | SG | `synovilsg.com` | Main store | 2026-07-24 | 6,002 | 2025-08-19 | 2026-09-30 |
| Synovil | SG | `sgsynovil.com` | Landing page | 2026-09-17 | 150 | 2026-06-22 | 2026-09-30 |

Notes:

- All 20 connections were `healthy` with 0 errors in the last 24h at pull time.
- The Adipocyde and Synovil landing pages are clones of an older store and
  share its order history. `woo-sync` drops copied orders on write
  (resumed 20 Sep 2026 after the clone dedupe).
- `lipidri.my` was the original seeded domain. It doesn't resolve; the live
  MY store is `lipidri.com`.
- `farmasijunior.com` and `farmasijuniorsg.com` have had no orders since
  early June.

---

## 2. Historical domains from Fighter, by brand

Orders are Fighter-imported orders only (cutoff 30 Jun 2026). **Live**
means the domain is also a live WooCommerce connection in section 1.

### OFICactus (86 domains, 56,474 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `hqoficactus.online` | 11,668 | 2023-07-18 | 2024-11-03 | — |
| `hqoficactus.com` | 8,210 | 2023-06-20 | 2024-11-05 | — |
| `oficactusofficial.store` | 3,783 | 2023-07-18 | 2024-07-14 | — |
| `oficactushq.info` | 3,609 | 2023-06-20 | 2024-11-03 | — |
| `hqoficactus.store` | 3,513 | 2023-07-18 | 2024-09-14 | — |
| `oficactus.net` | 2,703 | 2023-06-21 | 2024-05-03 | — |
| `hqoficactus.info` | 2,207 | 2023-06-27 | 2024-06-08 | — |
| `oficactushq.com` | 2,075 | 2023-06-21 | 2024-10-27 | — |
| `oficactus-hq.com` | 1,997 | 2023-06-23 | 2024-01-23 | — |
| `oficactus-malaysia.com` | 1,433 | 2023-07-13 | 2024-02-20 | — |
| `sgoficactus.com` | 1,409 | 2023-11-17 | 2024-10-14 | — |
| `jusoficactus.com` | 1,353 | 2023-07-11 | 2024-11-03 | — |
| `oficactussg.com` | 1,038 | 2023-11-16 | 2024-10-31 | — |
| `myoficactushq.com` | 1,035 | 2023-09-28 | 2024-10-29 | — |
| `oficactus.info` | 988 | 2023-11-16 | 2024-11-04 | — |
| `oficactusnatural.com` | 987 | 2023-07-14 | 2024-04-24 | — |
| `sgoficactushq.com` | 938 | 2023-11-16 | 2024-11-02 | — |
| `oficactus-official.com` | 933 | 2023-07-13 | 2024-02-15 | — |
| `hqoficactusofficial.com` | 665 | 2023-11-17 | 2024-10-29 | — |
| `oficactusmalaysia.com` | 664 | 2023-07-04 | 2024-11-18 | — |
| `oficactus.my` | 590 | 2023-06-24 | 2024-11-10 | — |
| `oficactus.shop` | 546 | 2023-06-21 | 2024-03-19 | — |
| `oficactusonline.com` | 524 | 2023-08-24 | 2024-11-04 | — |
| `jusoficactushq.com` | 350 | 2023-07-15 | 2024-02-22 | — |
| `oficactuss.store` | 269 | 2023-06-22 | 2023-11-14 | — |
| `oficactus-original.com` | 251 | 2023-07-28 | 2023-09-24 | — |
| `oficactushq.store` | 250 | 2023-11-16 | 2024-11-10 | — |
| `tempahoficactus.com` | 249 | 2023-07-08 | 2023-08-22 | — |
| `juskurusoficactus.net` | 206 | 2023-07-13 | 2024-06-30 | — |
| `originaloficactus.com` | 200 | 2023-09-12 | 2024-05-03 | — |
| `oficactusofficial.net` | 152 | 2023-07-10 | 2024-06-10 | — |
| `oficactus.com` | 136 | 2023-07-24 | 2024-10-29 | — |
| `oficactusmalaysiahq.com` | 125 | 2023-08-17 | 2024-12-16 | — |
| `oficactus-info.shop` | 117 | 2023-09-15 | 2024-07-04 | — |
| `oficactusasli.com` | 101 | 2023-11-16 | 2024-01-02 | — |
| `oficactusvitality.com` | 98 | 2023-09-23 | 2024-01-16 | — |
| `hqoficactus.shop` | 94 | 2023-06-27 | 2024-04-12 | — |
| `oficactusmy.com` | 81 | 2023-06-30 | 2024-03-17 | — |
| `oficactushq.shop` | 78 | 2023-08-14 | 2023-11-04 | — |
| `oficactusbotanic.com` | 68 | 2023-07-07 | 2024-02-03 | — |
| `oficactusoriginal.com` | 64 | 2023-07-15 | 2024-04-25 | — |
| `oficactus.org` | 59 | 2023-10-11 | 2024-03-03 | — |
| `juiceoficactus.com` | 48 | 2023-09-11 | 2024-04-04 | — |
| `oficactus-jus.com` | 44 | 2023-09-14 | 2024-01-20 | — |
| `oficactusonline.shop` | 42 | 2023-08-10 | 2024-06-25 | — |
| `myoficactus.shop` | 41 | 2023-06-25 | 2024-01-03 | — |
| `oficactuswanie.com` | 40 | 2024-02-14 | 2024-03-26 | — |
| `oficactusbeauty.com` | 40 | 2023-09-02 | 2023-11-10 | — |
| `jusoficactus.shop` | 39 | 2023-07-18 | 2023-08-23 | — |
| `myoficactus.com` | 32 | 2023-09-05 | 2023-09-27 | — |
| `oficactus2u.com` | 30 | 2023-09-08 | 2023-10-31 | — |
| `oficactus4u.com` | 29 | 2023-06-24 | 2025-02-03 | — |
| `oficactushealth.com` | 27 | 2023-10-17 | 2024-02-13 | — |
| `oficactusjuices.com` | 26 | 2023-11-08 | 2024-02-17 | — |
| `oficactus-wellness.com` | 24 | 2023-08-09 | 2023-10-03 | — |
| `oficactustore.online` | 22 | 2023-06-22 | 2023-09-29 | — |
| `oficactus93.com` | 21 | 2023-08-02 | 2024-02-19 | — |
| `oficactushq.asia` | 16 | 2023-10-11 | 2024-08-05 | — |
| `oficactusnature.com` | 13 | 2023-11-14 | 2023-12-07 | — |
| `oficactusjus.com` | 11 | 2023-07-30 | 2024-01-10 | — |
| `oficactus.asia` | 10 | 2023-09-15 | 2023-11-01 | — |
| `oficactusdetox.com` | 9 | 2023-10-09 | 2024-03-11 | — |
| `jus-oficactus.com` | 9 | 2023-09-24 | 2023-10-09 | — |
| `oficactusslim.com` | 9 | 2023-09-19 | 2024-01-10 | — |
| `oficactuss.com` | 8 | 2023-08-02 | 2024-11-11 | — |
| `oficactus.jomkembalisihat.com` | 8 | 2024-09-27 | 2024-10-25 | — |
| `sihatoficactus.shop` | 7 | 2023-07-10 | 2023-07-21 | — |
| `oficactus.store` | 7 | 2023-08-15 | 2024-03-03 | — |
| `oficactus.website` | 6 | 2024-01-28 | 2024-12-06 | — |
| `jusdietoficactus.com` | 6 | 2023-10-06 | 2023-10-11 | — |
| `baikihormonkurusoficactus.com` | 3 | 2023-09-17 | 2023-09-17 | — |
| `oficactus-beauty.com` | 3 | 2023-09-06 | 2023-09-06 | — |
| `kurusdenganoficactus.com` | 3 | 2023-07-06 | 2023-07-06 | — |
| `oficactus.site` | 3 | 2023-11-21 | 2024-06-26 | — |
| `myoficactus2u.com` | 2 | 2023-09-18 | 2023-09-29 | — |
| `oficactuskurus.com` | 2 | 2024-02-04 | 2024-03-18 | — |
| `oficactusfitbeauty.com` | 2 | 2023-09-15 | 2023-09-15 | — |
| `oficactusoficial.com` | 2 | 2023-06-26 | 2023-07-25 | — |
| `oficactusmybeauty.com` | 2 | 2023-10-06 | 2024-10-17 | — |
| `healthlineoficactus.com` | 2 | 2023-08-23 | 2023-11-03 | — |
| `oficactusmalaysia.online` | 2 | 2023-07-18 | 2023-07-25 | — |
| `oficactusmalaya.com` | 2 | 2024-02-04 | 2024-02-13 | — |
| `slim-oficactus.com` | 2 | 2023-07-08 | 2023-07-09 | — |
| `slimjusoficactus.com` | 2 | 2023-12-29 | 2024-03-10 | — |
| `oficactus.biz` | 1 | 2023-08-18 | 2023-08-18 | — |
| `oficactusmy.shop` | 1 | 2023-06-26 | 2023-06-26 | — |

### Synovil (5 domains, 31,326 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `synovil.com` | 27,623 | 2025-06-21 | 2026-06-30 | live |
| `synovilsg.com` | 3,601 | 2025-10-31 | 2026-06-30 | live |
| `synovilhq.com` | 70 | 2026-06-18 | 2026-06-30 | live |
| `synovil.com.my` | 20 | 2025-11-26 | 2026-06-18 | live |
| `sgsynovil.com` | 12 | 2026-06-22 | 2026-06-27 | live |

### Adipocyde (7 domains, 30,325 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `adipocyde.com` | 15,472 | 2025-10-31 | 2026-06-30 | live |
| `adipocydesg.com` | 6,698 | 2025-10-31 | 2026-06-30 | live |
| `adipocydehq.com` | 4,578 | 2026-01-15 | 2026-06-30 | live |
| `sgadipocydehq.com` | 2,664 | 2026-01-22 | 2026-06-30 | live |
| `hqadipocyde.com` | 591 | 2026-01-16 | 2026-06-28 | live |
| `sgadipocyde.com` | 318 | 2026-01-16 | 2026-06-25 | live |
| `adipocyde.my` | 4 | 2026-02-21 | 2026-06-28 | — |

### Eraxtanol (4 domains, 26,827 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `eraxtanol.com` | 25,029 | 2025-06-21 | 2026-03-19 | — |
| `eraxtanolsg.com` | 1,088 | 2025-06-21 | 2026-06-04 | — |
| `eraxtanolhq.com` | 707 | 2026-03-25 | 2026-06-11 | — |
| `eraxtanolsingapore.com` | 3 | 2026-04-01 | 2026-05-29 | — |

### Lipidri (2 domains, 18,275 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `lipidri.com` | 15,910 | 2025-06-20 | 2026-06-30 | live |
| `lipidrisg.com` | 2,365 | 2025-11-01 | 2026-06-30 | live |

### Metaponin (26 domains, 18,152 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `metaponinmalaysiahq.com` | 4,027 | 2024-12-24 | 2025-11-24 | — |
| `metaponinhq.com.my` | 3,588 | 2024-12-25 | 2026-02-03 | — |
| `metaponinmalaysia.com` | 2,958 | 2024-12-26 | 2025-11-26 | — |
| `metaponin.com.my` | 1,171 | 2024-12-27 | 2026-01-28 | — |
| `metaponin-mm.com` | 1,017 | 2025-01-02 | 2025-07-15 | — |
| `metaponinsingaporehq.com` | 969 | 2024-12-27 | 2025-08-21 | — |
| `mymetaponinhq.com` | 811 | 2024-12-31 | 2025-12-09 | — |
| `metaponinsingapore.com` | 781 | 2024-12-28 | 2025-10-11 | — |
| `sgmetaponin.com` | 617 | 2024-12-25 | 2025-10-05 | — |
| `metaponinsg.com` | 550 | 2025-01-02 | 2025-11-12 | — |
| `metaponin.com` | 388 | 2025-01-07 | 2025-10-02 | — |
| `metaponinfit.com` | 379 | 2025-01-02 | 2025-07-09 | — |
| `metaponinhq.com` | 232 | 2025-01-08 | 2025-09-22 | — |
| `metaponin.asia` | 185 | 2025-01-06 | 2026-01-29 | — |
| `metaponin.my` | 147 | 2024-12-27 | 2025-08-20 | — |
| `metaponin.originalhq.net` | 131 | 2025-01-01 | 2026-01-28 | — |
| `metaponin.shop` | 52 | 2024-12-31 | 2025-05-27 | — |
| `mymetaponin.com` | 46 | 2025-01-02 | 2025-05-25 | — |
| `metaponinmy.originalhq.net` | 28 | 2025-01-10 | 2025-05-14 | — |
| `metaponinmy.com` | 26 | 2025-03-27 | 2025-12-11 | — |
| `metaponin.wnhsale.com` | 18 | 2025-01-05 | 2025-05-14 | — |
| `metaponinhq.wnhsale.com` | 15 | 2025-01-11 | 2026-01-09 | — |
| `metaponinonline.shop` | 8 | 2025-01-13 | 2025-03-14 | — |
| `mymetaponin.kilang.my` | 4 | 2025-04-27 | 2026-02-12 | — |
| `metaponinhqmalaysia.com` | 3 | 2025-01-12 | 2025-03-07 | — |
| `metaponin.online` | 1 | 2025-01-07 | 2025-01-07 | — |

### Melasma (10 domains, 10,528 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `melasmacarehq.com` | 2,630 | 2024-12-30 | 2025-11-27 | — |
| `melasmacare.co` | 2,307 | 2024-12-30 | 2025-11-27 | — |
| `melasmacare.my` | 1,896 | 2024-12-30 | 2025-12-03 | — |
| `melasmacaremy.com` | 1,113 | 2024-12-30 | 2025-06-29 | — |
| `sgmelasmacare.com` | 1,093 | 2024-12-30 | 2025-11-23 | — |
| `melasmacaremalaysia.com` | 593 | 2025-01-01 | 2025-06-05 | — |
| `melasmacaresg.com` | 387 | 2024-12-31 | 2025-08-04 | — |
| `melasmacaresingapore.com` | 216 | 2024-12-30 | 2025-06-21 | — |
| `melasmacarehq.co` | 186 | 2024-12-30 | 2025-08-05 | — |
| `hqmelasmacare.com` | 107 | 2025-01-09 | 2025-10-12 | — |

### Morosil (2 domains, 8,828 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `morosil.com.my` | 6,549 | 2024-12-30 | 2026-04-16 | — |
| `morosilsg.com` | 2,279 | 2024-12-30 | 2026-04-30 | — |

### Makcik Kaulawa (1 domain, 1,616 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `makcikkaulawa.com` | 1,616 | 2023-06-21 | 2025-03-15 | — |

### Daravex (2 domains, 1,199 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `daravex.com` | 1,198 | 2025-06-23 | 2026-05-04 | — |
| `daravexsg.com` | 1 | 2025-07-18 | 2025-07-18 | — |

### Cavernosil (2 domains, 1,098 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `cavernosil.com` | 937 | 2026-06-19 | 2026-06-30 | live |
| `cavernosilsg.com` | 161 | 2026-06-24 | 2026-06-30 | live |

`farmasilelaki.com` (Cavernosil landing page) is in section 3: its name
doesn't contain the brand.

### Miroestro (2 domains, 708 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `miroestro.com` | 658 | 2025-06-20 | 2025-07-31 | — |
| `miroestrosg.com` | 50 | 2025-06-22 | 2025-07-24 | — |

### TheTuneMind (1 domain, 225 orders)

| Domain | Orders | First order | Last order | Live |
|---|---|---|---|---|
| `thetunemind.com` | 225 | 2023-06-28 | 2023-10-01 | — |

Glycoxil has no Fighter history; its two domains are in section 1 only.

---

## 3. Unattributed Fighter domains (75)

These have `brand_id = NULL` in Fighter staging because the domain doesn't
contain a brand name. The **Suggested brand** column is a guess for admin
confirmation, except where a live connection already settles it.

### Likely brand (15)

| Domain | Orders | First order | Last order | Suggested brand | Basis |
|---|---|---|---|---|---|
| `farmasilelaki.com` | 290 | 2026-06-23 | 2026-06-30 | Cavernosil | Live connection (confirmed) |
| `farmasijunior.com` | 7 | 2026-05-30 | 2026-06-02 | NuroKids | Live connection (confirmed) |
| `farmasijuniorsg.com` | 4 | 2026-05-30 | 2026-06-03 | NuroKids | Live connection (confirmed) |
| `nurokids.com` | 45 | 2026-06-01 | 2026-06-29 | NuroKids | Brand name; brand row added after the import's match ran |
| `nurokidsg.com` | 2 | 2026-06-02 | 2026-06-02 | NuroKids | Brand name (SG) |
| `oficact.us` | 701 | 2023-06-21 | 2024-02-05 | OFICactus | Brand name split across the TLD |
| `ofi-cactus.com` | 78 | 2023-07-05 | 2023-08-19 | OFICactus | Hyphenated spelling |
| `officactus.com` | 53 | 2023-10-02 | 2024-09-17 | OFICactus | Misspelling |
| `ofi2u.com` | 13 | 2023-09-16 | 2024-02-07 | OFICactus | Abbreviation; same period as OFICactus domains |
| `oficacts.store` | 9 | 2023-11-23 | 2024-01-05 | OFICactus | Misspelling |
| `ofi-cactushq.com` | 2 | 2023-07-11 | 2023-07-25 | OFICactus | Hyphenated spelling |
| `moroplus.com` | 450 | 2025-01-24 | 2025-09-28 | Morosil? | Name stem and dates overlap Morosil; unconfirmed |
| `phytoestrohq.com` | 8 | 2025-01-01 | 2025-01-23 | Miroestro? | Phytoestrogen product; predates `miroestro.com` |
| `phytoestro.com` | 2 | 2024-12-31 | 2025-01-06 | Miroestro? | As above |
| `sgphytoestro.com` | 1 | 2025-01-13 | 2025-01-13 | Miroestro? | As above |

### Unknown brand (60)

Mostly generic Malay landing pages ("kurus" = slim, "sihat" = healthy,
"beli sekarang" = buy now) from 2023 to 2024, the OFICactus era. The orders'
line items would show which product each sold.

| Domain | Orders | First order | Last order |
|---|---|---|---|
| `naksekarang.com` | 692 | 2023-06-22 | 2024-01-22 |
| `cantikluardalam.com` | 460 | 2023-06-25 | 2023-12-20 |
| `kurrussekarang.com` | 434 | 2023-07-07 | 2024-02-03 |
| `kajianpakar.com` | 395 | 2023-07-09 | 2024-03-23 |
| `znglowry.net` | 358 | 2023-06-21 | 2023-10-29 |
| `kurusmenawan.com` | 339 | 2023-07-24 | 2024-06-29 |
| `tipskurus30hari.com` | 227 | 2023-06-23 | 2024-04-15 |
| `znofficialhq.com` | 220 | 2023-06-21 | 2023-09-06 |
| `wanstopsolution.com` | 211 | 2023-07-06 | 2024-10-11 |
| `tipskurusbyqilla.com` | 168 | 2023-09-04 | 2024-08-27 |
| `nusantaraherbs.com` | 108 | 2023-06-30 | 2023-12-10 |
| `dapatsegera.com` | 100 | 2023-07-05 | 2024-01-02 |
| `herbshop4us.com` | 96 | 2023-08-12 | 2023-09-21 |
| `kuruscarasihat.com` | 86 | 2023-06-24 | 2023-08-20 |
| `herbshop2u.com` | 42 | 2023-08-16 | 2023-09-29 |
| `sihatbersama.com` | 38 | 2023-07-08 | 2023-10-07 |
| `herbaworksofficial.com` | 38 | 2023-07-22 | 2023-11-11 |
| `herbstechnology2000.com` | 30 | 2023-07-14 | 2023-12-07 |
| `nakmembeli.com` | 26 | 2023-06-28 | 2024-01-10 |
| `godambadan.online` | 24 | 2023-09-16 | 2023-12-28 |
| `sihatsecarasunnah.com` | 24 | 2023-07-08 | 2023-09-21 |
| `houseoflentik.com` | 21 | 2023-07-04 | 2023-07-17 |
| `mmstore.shop` | 20 | 2023-07-29 | 2024-03-05 |
| `biolifeproduct.com` | 18 | 2023-07-25 | 2023-08-25 |
| `jomkurussekarang.com` | 16 | 2023-07-06 | 2023-07-22 |
| `sihatdancantikluardalam.com` | 14 | 2023-07-23 | 2023-07-28 |
| `herba-terbaik.com` | 14 | 2023-08-02 | 2023-09-18 |
| `barangmolek.store` | 12 | 2025-01-02 | 2025-06-21 |
| `misikurus.com` | 11 | 2023-09-30 | 2023-11-17 |
| `resepiherba.com` | 11 | 2023-06-24 | 2023-07-14 |
| `2buyhere.com` | 9 | 2023-08-24 | 2023-12-05 |
| `sihatabadi.com` | 9 | 2025-01-07 | 2025-03-15 |
| `juskurus.com` | 8 | 2023-07-03 | 2023-07-25 |
| `sihatlife.com` | 7 | 2025-03-17 | 2025-04-27 |
| `belisegera.shop` | 7 | 2023-07-07 | 2023-07-27 |
| `hanglekir.com` | 6 | 2025-01-11 | 2025-05-05 |
| `jomorder.store` | 6 | 2023-07-14 | 2023-08-08 |
| `znofficial.com` | 6 | 2023-08-06 | 2023-08-08 |
| `naksehatcantik.com` | 6 | 2023-07-10 | 2023-12-08 |
| `kedainisa.com` | 5 | 2023-07-10 | 2024-06-02 |
| `ordersekarang.store` | 5 | 2023-10-16 | 2024-01-04 |
| `nakkurussekarang.com` | 5 | 2023-07-10 | 2023-07-21 |
| `belisekarang.store` | 5 | 2023-07-16 | 2023-07-25 |
| `nakordersegera.com` | 5 | 2023-07-11 | 2023-08-11 |
| `halalnanotechnology.com` | 4 | 2023-08-18 | 2023-09-01 |
| `belisegera.store` | 4 | 2023-07-16 | 2023-07-26 |
| `officialhq.store` | 4 | 2023-07-17 | 2023-07-17 |
| `znhealth.net` | 3 | 2023-08-01 | 2023-08-01 |
| `beliharini.com` | 3 | 2023-07-17 | 2023-07-25 |
| `manisjelita.com` | 3 | 2023-12-05 | 2024-01-04 |
| `projekkurus.com` | 2 | 2023-08-08 | 2023-11-07 |
| `thestorebyzafs.com` | 2 | 2023-07-10 | 2023-07-25 |
| `herbadagang.com` | 2 | 2023-08-14 | 2023-08-15 |
| `beautybayu.com` | 1 | 2023-07-08 | 2023-07-08 |
| `beliplz.shop` | 1 | 2025-03-01 | 2025-03-01 |
| `makmuda.com` | 1 | 2023-07-19 | 2023-07-19 |
| `kurusdansihat.shop` | 1 | 2023-08-17 | 2023-08-17 |
| `ashwagandhaofficialhq.com` | 1 | 2023-07-06 | 2023-07-06 |
| `kedaibesar.shop` | 1 | 2023-10-11 | 2023-10-11 |
| `jomsihat.shop` | 1 | 2023-10-24 | 2023-10-24 |

---

## Refreshing this register

This file is a snapshot. To refresh it, re-run these against the
`effen-os` Supabase project:

```sql
-- Live WooCommerce connections
select config->>'brand_slug' as brand, config->>'country_code' as market,
       regexp_replace(config->>'base_url', '^https?://', '') as domain,
       created_at::date as connected, status
from public.integration_connections
where provider = 'WooCommerce'
order by 1, 2, created_at;

-- Fighter history domains by brand
select coalesce(b.name, '(unmapped)') as brand, s.domain, count(*) as orders,
       min(s.placed_at)::date as first_order, max(s.placed_at)::date as last_order
from private.fighter_orders_staging s
left join public.brands b on b.id = s.brand_id
where s.domain is not null
group by 1, 2
order by 1, 3 desc;
```
