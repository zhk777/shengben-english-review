// Keep a review round stable while its source wrong-book is being updated.
// Otherwise removing the answered item shifts the next item into the same slot.
export function snapshotReviewItems(items) {
  return items.map((item) => ({ ...item, wrong: item.wrong ? { ...item.wrong } : item.wrong }));
}
