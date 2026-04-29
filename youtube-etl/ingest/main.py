"""Cloud Run entry point. One service, four endpoints — Cloud Scheduler hits each
on its own cron. Keep all routes idempotent so re-runs (e.g., scheduler retries)
don't double-write."""
import logging

from flask import Flask, jsonify

from handlers import analytics as h_analytics
from handlers import daily as h_daily
from handlers import hourly as h_hourly
from handlers import live_poll as h_live
from lib.config import load as load_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = Flask(__name__)
_cfg = None


def cfg():
    global _cfg
    if _cfg is None:
        _cfg = load_config()
    return _cfg


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/jobs/daily")
def daily():
    return jsonify(h_daily.run(cfg()))


@app.post("/jobs/hourly")
def hourly():
    return jsonify(h_hourly.run(cfg()))


@app.post("/jobs/live-poll")
def live_poll():
    return jsonify(h_live.run(cfg()))


@app.post("/jobs/analytics")
def analytics():
    return jsonify(h_analytics.run(cfg()))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
