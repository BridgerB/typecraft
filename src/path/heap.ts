/**
 * Binary min-heap ordered by PathNode.f cost.
 * 1-indexed array (index 0 unused) for simpler parent/child math.
 */

import type { PathNode } from "./types.ts";

/** Create an empty min-heap. */
export const createHeap = (): PathNode[] => [];

/** Whether the heap has no elements. */
export const heapIsEmpty = (heap: PathNode[]): boolean => heap.length <= 1;

/** Insert a node into the heap. */
export const heapPush = (heap: PathNode[], node: PathNode): void => {
	if (heap.length === 0) heap.push(node); // sentinel at 0
	heap.push(node);
	let i = heap.length - 1;
	let parent = i >>> 1;
	while (i > 1 && heap[parent]!.f > heap[i]!.f) {
		[heap[parent]!, heap[i]!] = [heap[i]!, heap[parent]!];
		i = parent;
		parent = i >>> 1;
	}
};

/** Remove and return the minimum-f node. */
export const heapPop = (heap: PathNode[]): PathNode => {
	const min = heap[1]!;
	const last = heap.pop()!;
	if (heap.length > 1) {
		heap[1] = last;
		let i = 1;
		const size = heap.length;
		for (;;) {
			const left = i * 2;
			const right = left + 1;
			let smallest = i;
			if (left < size && heap[left]!.f < heap[smallest]!.f) smallest = left;
			if (right < size && heap[right]!.f < heap[smallest]!.f)
				smallest = right;
			if (smallest === i) break;
			[heap[i]!, heap[smallest]!] = [heap[smallest]!, heap[i]!];
			i = smallest;
		}
	}
	return min;
};

/** Re-bubble a node after its f-cost decreased. */
export const heapUpdate = (heap: PathNode[], node: PathNode): void => {
	let i = heap.indexOf(node);
	if (i <= 0) return;
	let parent = i >>> 1;
	while (i > 1 && heap[parent]!.f > heap[i]!.f) {
		[heap[parent]!, heap[i]!] = [heap[i]!, heap[parent]!];
		i = parent;
		parent = i >>> 1;
	}
};
