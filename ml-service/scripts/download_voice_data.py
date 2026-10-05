"""
download_voice_data.py -- fetch the public datasets used by train_voice_model.py

  * Sakar et al. 2018, "Parkinson's Disease Classification", UCI ML Repository #470
    (CC BY 4.0) -> data/raw/sakar/pd_speech_features.csv
  * Iyer et al. 2023, "Voice Samples for Patients with Parkinson's Disease and
    Healthy Controls", figshare 23849127 (CC BY 4.0) -> data/raw/figshare/

The UCI archive contains a .rar file. It is extracted with `tar` (bsdtar /
Windows tar.exe read rar); on systems without it, install `unar` or extract
pd_speech_features.csv manually into data/raw/sakar/.

Usage:  python scripts/download_voice_data.py
"""

import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")

SAKAR_URL = "https://archive.ics.uci.edu/static/public/470/parkinson+s+disease+classification.zip"
FIGSHARE_FILES = {
    "PD_AH.zip": "https://ndownloader.figshare.com/files/41836710",
    "HC_AH.zip": "https://ndownloader.figshare.com/files/41836713",
    "demo.xlsx": "https://ndownloader.figshare.com/files/41836707",
}


def fetch(url, dest):
    if os.path.exists(dest):
        print(f"    exists: {os.path.relpath(dest, ROOT)}")
        return
    print(f"    downloading {url}")
    urllib.request.urlretrieve(url, dest)


def extract_rar(rar, out_dir):
    for tool in (["tar", "-xf", rar, "-C", out_dir], ["bsdtar", "-xf", rar, "-C", out_dir],
                 ["unar", "-o", out_dir, "-f", rar]):
        if shutil.which(tool[0]):
            if subprocess.run(tool, capture_output=True).returncode == 0:
                return True
    return False


def main():
    sakar = os.path.join(RAW, "sakar")
    os.makedirs(sakar, exist_ok=True)
    csv = os.path.join(sakar, "pd_speech_features.csv")
    print("[*] Sakar 2018 (UCI #470)")
    if not os.path.exists(csv):
        z = os.path.join(sakar, "sakar.zip")
        fetch(SAKAR_URL, z)
        zipfile.ZipFile(z).extractall(sakar)
        rar = os.path.join(sakar, "pd_speech_features.rar")
        if os.path.exists(rar) and not extract_rar(rar, sakar):
            sys.exit(f"[-] Could not extract {rar}; extract pd_speech_features.csv into {sakar} manually.")
    print(f"    ok: {os.path.relpath(csv, ROOT)}")

    fig = os.path.join(RAW, "figshare")
    os.makedirs(fig, exist_ok=True)
    print("[*] figshare 23849127")
    for name, url in FIGSHARE_FILES.items():
        dest = os.path.join(fig, name)
        fetch(url, dest)
        if name.endswith(".zip"):
            zipfile.ZipFile(dest).extractall(fig)
    n = sum(f.endswith(".wav") for _, _, fs in os.walk(fig) for f in fs)
    print(f"    ok: {n} recordings")


if __name__ == "__main__":
    main()
