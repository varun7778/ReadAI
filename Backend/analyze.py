"""
analyze.py — CLI entry point for the language improvement tracker.

Usage:
  python analyze.py path/to/transcript.txt --duration 480
  python analyze.py path/to/transcript.txt --duration 480 --pretty
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from language_analyzer import init_db, run_analysis


def main():
    parser = argparse.ArgumentParser(
        description="Run language analysis on a transcript file."
    )
    parser.add_argument("transcript_file", help="Path to plain-text transcript")
    parser.add_argument("--duration", type=int, required=True,
                        help="Recording duration in seconds")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print the JSON output")
    args = parser.parse_args()

    transcript_path = Path(args.transcript_file)
    if not transcript_path.exists():
        print(f"Error: file not found: {transcript_path}", file=sys.stderr)
        sys.exit(1)

    transcript = transcript_path.read_text(encoding="utf-8").strip()
    if not transcript:
        print("Error: transcript file is empty", file=sys.stderr)
        sys.exit(1)

    init_db()

    try:
        result = run_analysis(transcript, args.duration)
    except Exception as e:
        print(f"Analysis failed: {e}", file=sys.stderr)
        sys.exit(1)

    indent = 2 if args.pretty else None
    print(json.dumps(result, indent=indent, ensure_ascii=False))

    # Human-readable summary
    print("\n─── Summary ────────────────────────────────────", file=sys.stderr)
    print(f"  Session ID      : {result['sessionId']}", file=sys.stderr)
    print(f"  Overall score   : {result['overallScore']}/10", file=sys.stderr)
    print(f"  Fluency         : {result['fluencyScore']}/10", file=sys.stderr)
    print(f"  Naturalness     : {result['naturalnessScore']}/10", file=sys.stderr)
    print(f"  Filler rate     : {result['fillerRate']}/min", file=sys.stderr)
    print(f"  Vocab richness  : {result['vocabularyRichness']}", file=sys.stderr)
    print(f"  Corrections     : {len(result['corrections'])}", file=sys.stderr)
    print(f"  Recurring       : {sum(1 for c in result['corrections'] if c['isRecurring'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
