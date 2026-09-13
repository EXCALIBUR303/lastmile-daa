Two terminal tabs, from the repo root.

Backend:
    cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000

Frontend:
    cd frontend && NODE_OPTIONS=--no-network-family-autoselection npm run dev

Then open http://localhost:5173 . Tests: cd backend && ./.venv/bin/python -m pytest -q
