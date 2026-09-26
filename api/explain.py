"""Person 4: one calm sentence about the detour, in English, Spanish and Haitian Creole.

Test: uv run python -m api.explain
Only the extra minutes and report summaries go to Gemini, never the trip's start or end.
"""

import asyncio
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from api.routing import ROOT

load_dotenv(ROOT / ".env")

# AGENTS.md says 4 s, but Gemini often takes 3-5 s, so 4 s cut it off about half the time.
TIMEOUT_S = 6
# Same trip -> same sentence, so Gemini is only asked once.
_saved = {}


class Sentences(BaseModel):
    en: str
    es: str
    ht: str


def backup_sentence(extra_minutes, report_count):
    """Plain sentence used when Gemini is slow, down, or has no key."""
    if report_count == 1:
        return {
            "en": f"This route adds {extra_minutes} minutes and avoids 1 area with reported activity.",
            "es": f"Esta ruta añade {extra_minutes} minutos y evita 1 zona con actividad reportada.",
            "ht": f"Wout sa a ajoute {extra_minutes} minit epi li evite 1 zòn kote yo rapòte aktivite.",
        }
    if report_count:
        return {
            "en": f"This route adds {extra_minutes} minutes and avoids {report_count} areas with reported activity.",
            "es": f"Esta ruta añade {extra_minutes} minutos y evita {report_count} zonas con actividad reportada.",
            "ht": f"Wout sa a ajoute {extra_minutes} minit epi li evite {report_count} zòn kote yo rapòte aktivite.",
        }
    return {
        "en": "The usual route looks clear of recent reported activity.",
        "es": "La ruta habitual parece libre de actividad reportada reciente.",
        "ht": "Wout nòmal la sanble pa gen aktivite yo rapòte dènyèman.",
    }


def place_name(summary):
    # "2 reports near Little Havana" -> "Little Havana"
    return summary.split(" near ", 1)[-1]


def build_prompt(extra_minutes, summaries):
    count = len(summaries)
    area_words = "1 area" if count == 1 else f"{count} areas"
    places = ", ".join(place_name(s) for s in summaries)
    return (
        "You write one short sentence for a navigation app that routes people around "
        "areas where community members reported ICE activity.\n"
        f"Facts: the suggested route takes {extra_minutes} extra minutes and avoids "
        f"{area_words} with reported activity, near: {places}.\n"
        f"Rules: at most 25 words. Calm and factual. Mention the {extra_minutes} extra minutes "
        f"and say it avoids exactly {area_words} with reported activity. You may name the places. "
        "Do not mention numbers of reports. Never say 'danger', 'raid' or 'run'. "
        "Do not add anything that is not in the facts.\n"
        "Return the same sentence in English (en), Spanish (es) and Haitian Creole (ht)."
    )


async def explain(extra_minutes, hazards_avoided, lang=None):
    """Return {"en", "es", "ht"} (or just one language if lang is given).

    hazards_avoided: summaries like "2 reports near Little Havana",
    or the circles' property dicts (their "summary" is used).
    """
    summaries = [h["summary"] if isinstance(h, dict) else str(h) for h in hazards_avoided]
    key = (extra_minutes, tuple(summaries))

    # Nothing avoided: the plain "usual route looks clear" sentence is enough.
    if not summaries:
        result = backup_sentence(extra_minutes, 0)
        return result[lang] if lang else result

    if key not in _saved:
        try:
            _saved[key] = await asyncio.wait_for(_ask_gemini(extra_minutes, summaries), TIMEOUT_S)
        except Exception:
            # Don't save the backup, so the next request tries Gemini again.
            result = backup_sentence(extra_minutes, len(summaries))
            return result[lang] if lang else result

    result = _saved[key]
    return result[lang] if lang else result


async def _ask_gemini(extra_minutes, summaries):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = await client.aio.models.generate_content(
        model=os.environ["GEMINI_MODEL"],
        contents=build_prompt(extra_minutes, summaries),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Sentences,
            temperature=0.3,
            # "low" keeps answers around 3 s, under the 4 s limit.
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        ),
    )
    return Sentences.model_validate_json(response.text).model_dump()


async def demo():
    trips = [
        (6, ["2 reports near Little Havana"]),
        (11, ["4 reports near Doral", "3 reports near Hialeah"]),
        (0, []),
    ]
    for extra, avoided in trips:
        result = await explain(extra, avoided)
        if not avoided:
            source = "plain, no detour"
        elif result == backup_sentence(extra, len(avoided)):
            source = "backup"
        else:
            source = "Gemini"
        print(f"\nTrip: +{extra} min, avoids {len(avoided)}  [{source}]")
        for lang, text in result.items():
            print(f"  {lang}: {text}")


if __name__ == "__main__":
    asyncio.run(demo())
