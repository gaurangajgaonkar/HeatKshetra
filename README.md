# HeatKshetra
# Heat-Health Risk Backend

A Python/FastAPI backend for a geographically resolved
Heat-Health Risk Index.

The system combines:

- Environmental heat exposure
- Relative risk
- Demographic vulnerability
- Ward-level risk classification

The current version is designed as a transparent prototype
for the Smart India Hackathon project.

---

## Important methodology note

This project currently implements a deterministic risk index.

It is NOT a trained machine-learning model.

There is currently:

- no model training
- no `model.fit()`
- no learned neural network
- no machine-learning accuracy score

The current architecture is:

```text
Temperature
     ↓
Relative Risk
     ↓
+
Ward Vulnerability
     ↓
Heat-Health Risk Index
     ↓
Risk Category
