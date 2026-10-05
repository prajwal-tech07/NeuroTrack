import requests
import json

payload = {
    "modules": {
        "face": {
            "features": {
                "asymmetryIndex": 0.03,
                "blinkRate": 18.0,
                "expressivityIndex": 0.15,
                "smileAmplitude": 0.22,
                "smileAmplitudeLeft": 0.22,
                "smileAmplitudeRight": 0.21,
                "eyeOpenAsymmetry": 0.02
            },
            "quality": 1.0
        },
        "hand": {
            "features": {
                "tapFrequencyHz": 4.8,
                "tapAmplitudeMean": 0.35,
                "tapAmplitudeDecay": 0.05,
                "tapIntervalCv": 0.12,
                "tremorPeakHz": 9.2,
                "tremorPowerRatio": 0.03
            },
            "quality": 1.0
        }
    },
    "age": 35
}

res = requests.post("http://127.0.0.1:8000/api/v1/score/fusion", json=payload)
print(f"Status: {res.status_code}")
print(json.dumps(res.json(), indent=2))
