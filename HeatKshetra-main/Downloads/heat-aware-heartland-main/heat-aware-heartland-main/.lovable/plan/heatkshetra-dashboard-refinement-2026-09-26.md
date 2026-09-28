# Heatkshetra dashboard refinement

## Scope
- Preserve the current dark navy Heatkshetra dashboard, existing content, and approximate 40/60 split.
- Replace the separate heat blobs with one continuous clipped GIS overlay spanning Mumbai, Thane, and Navi Mumbai, while retaining map detail and the existing legend.
- Strengthen the Bandra location marker with a clearer blue pin and subtle pulse.
- Increase the visual emphasis of the 67/100 gauge and HIGH RISK label without moving the left-panel sections.
- Tighten desktop sizing and spacing so the main dashboard fills the viewport without unnecessary height.
- Keep all five navigation items clickable and target existing sections/placeholders on the current page.

## Technical details
- Build the continuous heat-risk layer as one SVG overlay with irregular geographic masks, gradients, and soft transitions over the existing Mumbai map asset.
- Keep all palette and presentation values in the shared design tokens/styles.
- Add or adjust section anchors only; no new pages or feature logic.
- Verify the desktop view, mobile stacking, navigation targets, location pulse, forecast interactions, and current build status.
