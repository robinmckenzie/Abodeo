// The wording the person sees about images (AD #48 Add Images To Projects),
// kept together so that it can be tuned in one place.
import type { ImageFailure } from "./images-client";
import { maxCaptionLength } from "./images-api";

export const signInToAddMessage = "Sign in to add images";
export const noProjectOpenMessage = "Open a project to add an image to it.";
export const unsupportedFilesMessage =
  "Sorry, only JPEG and PNG files can be uploaded";
export const unsavedProjectMessage = "Save the project first to add an image.";

export const captionChangedElsewhereMessage =
  "This caption was changed on another device. Showing the saved one.";
export const captionTooLongMessage = `Sorry, a caption can be up to ${maxCaptionLength} characters.`;

// Why an image was refused, or could not be shown, saved or removed.
export function describeImageFailure(reason: ImageFailure) {
  switch (reason) {
    case "unsupported-format":
      return "Sorry, only JPEG and PNG images can be added.";
    case "too-large":
      return "Sorry, your image is too large.";
    case "no-space":
      return "Sorry, there isn't enough image space left in your account.";
    case "shared-storage-full":
      return "Sorry, Abodeo has no space left for images at the moment. Your existing images are kept.";
    case "caption-too-long":
      return captionTooLongMessage;
    case "conflict":
      return captionChangedElsewhereMessage;
    case "signed-out":
      return "You have been signed out.";
    case "account-changed":
      return "This page is no longer signed in to this account.";
    case "not-found":
      return "This image or project is no longer in your account.";
    case "refused":
      return "Abodeo could not accept this.";
    case "unreachable":
      return "Abodeo cannot reach your images right now.";
  }
}

export type RefusedImage = { name: string; reason: ImageFailure };

// One line for each image that was refused, with its name, so that when
// several are added at once the person can tell which were not.
export function describeRefusals(refused: RefusedImage[]) {
  return refused.map(
    ({ name, reason }) => `${name}: ${describeImageFailure(reason)}`,
  );
}
