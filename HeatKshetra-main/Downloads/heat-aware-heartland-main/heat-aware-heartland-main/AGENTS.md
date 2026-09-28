<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project architecture

- Keep the Heatkshetra prototype frontend-only with deterministic Mumbai sample data so the SIH demo never depends on a live API.
- The dashboard GIS map is a real Leaflet + OpenStreetMap map (lazy client-only); heat-risk comes as GeoJSON from `VITE_HEAT_RISK_API_URL` with mock fallback in `src/lib/heat-risk.ts`. Visual tokens stay in `src/styles.css`.
