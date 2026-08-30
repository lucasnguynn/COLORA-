# COLORA Brand UI

This version applies the supplied COLORA brand guideline to the web interface.

## Typography
- Headings / display: Didot.
- Body / UI: Open Sans.
- For devices that do not have Didot installed, the interface falls back to Bodoni Moda, Bodoni 72/Bodoni MT, then Georgia.
- Open Sans and Bodoni Moda fallback are loaded from Google Fonts; no font files are bundled in the project.

## Palette
- Ivory: `#F4EDE1`
- Navy: `#002451`
- Warm gold: `#B08A5B`
- Terracotta red: `#8E2F2A`
- Emerald green: `#0F6857`
- Sand: `#DBC9B4`
- Deep brown: `#4A2E23`

## Updated screens
- Staff login
- Product Identity Console
- Product Passport
- QR preview / downloaded QR colors

## Main styling file
`public/brand.css`

The original page logic and backend behavior are preserved. The brand stylesheet is loaded after the prototype styles so it safely overrides the visual system without changing authentication/database behavior.
