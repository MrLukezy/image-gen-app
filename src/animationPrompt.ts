export function buildSpriteSheetPrompt(actionName: string, frameCount: number): string {
  return `Create a sprite sheet animation of a character performing the following action: "${actionName}".

Generate exactly ${frameCount} frames arranged in a single horizontal strip (all frames in one row).
Each frame should show a sequential progression of the action from start to finish.

Requirements:
- All ${frameCount} frames must be on a single horizontal image strip
- Each frame should be clearly separated and equal in size
- The character should be in a consistent pose/style across all frames
- Show smooth, fluid motion progression
- Clean white or transparent background
- Side view perspective for best animation clarity
- Game sprite sheet style, pixel-perfect alignment`;
}

export function buildFinalFramesPrompt(
  actionName: string,
  frameCount: number,
  hasReference: boolean
): string {
  const refInstruction = hasReference
    ? `Use the provided character reference image(s) to maintain consistent character design, proportions, colors, and style across all frames.`
    : `Maintain a consistent character design throughout all frames.`;

  return `Based on the sprite sheet provided, generate ${frameCount} individual frames of a character performing the action: "${actionName}".

${refInstruction}

Requirements:
- Extract and render each of the ${frameCount} frames from the sprite sheet as individual images
- Maintain perfect character consistency with the reference across all frames
- Preserve the exact pose and motion from each frame of the sprite sheet
- Clean, transparent or solid background
- High quality rendering suitable for game animation
- All frames should be the same size and aspect ratio`;
}

export function validateFrameCount(count: number): boolean {
  return count >= 2 && count <= 16 && Number.isInteger(count);
}

export function getDefaultFrameCount(): number {
  return 8;
}
