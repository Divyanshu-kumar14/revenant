import { extractionSchema, type Extraction, type ExtractionResult, type Extractor } from "./provider.ts";

/** The authored source of truth: the fixture's output text, parsed, never re-serialised. */
const FIXTURE_RAW = `{
  "transcription": null,
  "title": "Fixture: mill pond at first light",
  "description": "A made-up test photograph of a mill pond and footbridge at dawn, used only by tests and demos.",
  "date": {
    "display": "June 14, 1911",
    "start": "1911-06-14",
    "end": "1911-06-14",
    "precision": "day"
  },
  "people": [
    { "name": "Ada Fixture", "confidence": 0.31 },
    { "name": "Thomas Example", "confidence": 0.88 }
  ],
  "places": [
    { "name": "Fixtureville", "confidence": 0.55 }
  ],
  "subjects": [
    { "name": "Mill ponds", "confidence": 0.81 },
    { "name": "Footbridges", "confidence": 0.74 }
  ],
  "confidence": {
    "transcription": 0,
    "title": 0.82,
    "description": 0.64,
    "date": 0.93,
    "people": 0.31,
    "places": 0.55,
    "subjects": 0.77
  }
}
`;

/**
 * Fixed, recognisably fake output for unit tests, browser tests and demos. It never reads the
 * image, never calls the network, and returns the same result for every input. `extract()`
 * takes no parameter on purpose: the signature is shorter than the interface's, which the type
 * accepts, and an unused parameter would only produce a lint warning.
 */
export class FixtureExtractor implements Extractor {
  readonly model = "fixture";
  readonly promptVersion = "fixture";

  async extract(): Promise<ExtractionResult> {
    const extraction: Extraction = extractionSchema.parse(JSON.parse(FIXTURE_RAW));
    return {
      extraction,
      raw: FIXTURE_RAW,
      repaired: false,
      coerced: false,
    };
  }
}
