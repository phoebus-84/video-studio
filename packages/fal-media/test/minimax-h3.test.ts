import { describe, it, expect } from "vitest";
import {
  getProfile,
  requireValidParameters,
  minimaxH3TextToVideo,
  minimaxH3ImageToVideo,
  minimaxH3ReferenceToVideo,
} from "../src/profiles.js";
import { VideoProfileContract } from "../src/contracts/v1.js";
import { FalValidationError, FalContractError } from "../src/errors.js";
import type { GenerationInput } from "../src/types.js";

/**
 * MiniMax H3 produces video rather than images, which the default output
 * parser cannot see, and takes reference arrays with hard count limits that
 * cost money to discover the hard way.
 */
describe("MiniMax H3", () => {
  const input = (parameters: Record<string, unknown>, endpointId: string): GenerationInput => ({
    idempotencyKey: "test-key",
    binding: { endpointId, contractVersion: "v1", baseUrl: "" },
    parameters,
    timeoutMs: 60_000,
  });

  describe("profiles", () => {
    it("registers all three endpoints", () => {
      expect(getProfile("minimax/h3/text-to-video@v1")).toBeTruthy();
      expect(getProfile("minimax/h3/image-to-video@v1")).toBeTruthy();
      expect(getProfile("minimax/h3/reference-to-video@v1")).toBeTruthy();
    });

    it("records a schema fingerprint, so a generation can be traced to its schema", () => {
      expect(minimaxH3TextToVideo.schemaFingerprint).toBeTruthy();
      expect(minimaxH3TextToVideo.pricing.currency).toBe("USD");
    });

    it("accepts a minimal text-to-video request", () => {
      const params = requireValidParameters(minimaxH3TextToVideo, { prompt: "a quiet street" });
      expect(params.prompt).toBe("a quiet street");
      // Defaults come from the profile, not from the caller guessing.
      expect(params.duration).toBe(5);
      expect(params.resolution).toBe("2K");
      expect(params.aspect_ratio).toBe("16:9");
    });

    it("rejects a resolution the endpoint does not offer", () => {
      expect(() =>
        requireValidParameters(minimaxH3TextToVideo, { prompt: "x", resolution: "8K" }),
      ).toThrow(FalValidationError);
    });

    it("rejects a duration outside the supported range", () => {
      expect(() =>
        requireValidParameters(minimaxH3TextToVideo, { prompt: "x", duration: 60 }),
      ).toThrow(FalValidationError);
    });

    it("requires an opening frame for image-to-video", () => {
      expect(() =>
        requireValidParameters(minimaxH3ImageToVideo, { prompt: "x" }),
      ).toThrow(FalValidationError);

      const ok = requireValidParameters(minimaxH3ImageToVideo, {
        prompt: "x",
        image_url: "https://example.com/first.png",
      });
      expect(ok.image_url).toBe("https://example.com/first.png");
    });

    it("allows adaptive aspect ratio only where the endpoint offers it", () => {
      expect(
        requireValidParameters(minimaxH3ReferenceToVideo, { prompt: "x", aspect_ratio: "adaptive" })
          .aspect_ratio,
      ).toBe("adaptive");

      expect(() =>
        requireValidParameters(minimaxH3TextToVideo, { prompt: "x", aspect_ratio: "adaptive" }),
      ).toThrow(FalValidationError);
    });
  });

  describe("reference limits", () => {
    it("accepts references within the documented limits", () => {
      const params = requireValidParameters(minimaxH3ReferenceToVideo, {
        prompt: "Image1 defines Maya",
        reference_image_urls: ["https://example.com/1.png", "https://example.com/2.png"],
        reference_audio_urls: ["https://example.com/voice.wav"],
      });
      expect(params.reference_image_urls).toHaveLength(2);
    });

    it("refuses too many references before spending anything", () => {
      // Ten images exceeds the limit of nine. Discovering that from the
      // provider would mean paying for the round trip.
      expect(() =>
        requireValidParameters(minimaxH3ReferenceToVideo, {
          prompt: "x",
          reference_image_urls: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.png`),
        }),
      ).toThrow(FalValidationError);

      expect(() =>
        requireValidParameters(minimaxH3ReferenceToVideo, {
          prompt: "x",
          reference_video_urls: ["a", "b", "c", "d"].map((n) => `https://example.com/${n}.mp4`),
        }),
      ).toThrow(FalValidationError);
    });

    it("refuses a reference list that is not a list of URLs", () => {
      expect(() =>
        requireValidParameters(minimaxH3ReferenceToVideo, {
          prompt: "x",
          reference_image_urls: "https://example.com/one.png",
        }),
      ).toThrow(FalValidationError);

      expect(() =>
        requireValidParameters(minimaxH3ReferenceToVideo, {
          prompt: "x",
          reference_image_urls: [42],
        }),
      ).toThrow(FalValidationError);
    });
  });

  describe("video output", () => {
    const contract = new VideoProfileContract(minimaxH3TextToVideo);

    it("parses the single video file H3 returns", () => {
      const result = contract.parseResponse(
        input({ prompt: "x" }, "minimax/h3/text-to-video"),
        {
          request_id: "req-h3-1",
          status: "COMPLETED",
          result: {
            video: {
              url: "https://fal.media/files/out.mp4",
              content_type: "video/mp4",
              file_name: "out.mp4",
              file_size: 8_400_000,
            },
          },
        },
      );

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]!.url).toBe("https://fal.media/files/out.mp4");
      expect(result.outputs[0]!.contentType).toBe("video/mp4");
      expect(result.outputs[0]!.contentLength).toBe(8_400_000);
      // Provenance must survive: it is how a render traces back to its schema.
      expect(result.profileId).toBe("minimax/h3/text-to-video@v1");
      expect(result.schemaFingerprint).toBeTruthy();
    });

    it("fails loudly when the response carries no video", () => {
      // The default parser answers "no outputs" for a missing images array.
      // Silently reporting zero outputs for a paid video generation would hide
      // the failure until the render found nothing to use.
      expect(() =>
        contract.parseResponse(input({ prompt: "x" }, "minimax/h3/text-to-video"), {
          request_id: "req-h3-2",
          status: "COMPLETED",
          result: { images: [] },
        }),
      ).toThrow(FalContractError);
    });
  });
});
