<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';

	let {
		sender,
		text,
		isError = false
	}: { sender: 'user' | 'ai'; text: string; isError?: boolean } = $props();

	// ── Copy to clipboard ─────────────────────────────────────────────────────
	// AI message text is pre-rendered HTML; extract plain text via the DOM.
	// Not shown on error messages (copying an error string is useless).
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout>;

	function copy() {
		if (!browser || !navigator.clipboard) return;
		const el = document.createElement('div');
		el.innerHTML = text;
		const plainText = (el.textContent || el.innerText || '').trim();
		navigator.clipboard.writeText(plainText).then(() => {
			copied = true;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => { copied = false; }, 1500);
		});
	}

	onDestroy(() => clearTimeout(copyTimer));
</script>

{#if sender === 'user'}
	<div class="flex justify-end">
		<div
			class="max-w-[75%] px-4 py-3 rounded-3xl rounded-br-sm
			       bg-gradient-to-br from-blue-500 to-cyan-500
			       text-white text-sm leading-relaxed shadow-md"
			style="animation: bubble-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;"
		>
			{text}
		</div>
	</div>
{:else}
	<!-- group scoped to the bubble so copy button only responds to bubble hover -->
	<div class="flex justify-start">
		<div class="group relative max-w-[75%]">
			<!--
				AI message text is stored as pre-sanitized HTML (rendered server-side
				via marked + sanitize-html before addMessage). No client-side sanitize
				step needed — safe to use {@html} directly.
			-->
			<div
				class="px-4 py-3 pr-8 rounded-3xl rounded-bl-sm
				       bg-stone-800/90 border border-white/8 border-l-2 border-l-cyan-500/50
				       text-stone-100 text-sm leading-relaxed ai-prose"
			>
				{@html text}
			</div>
			{#if !isError}
				<!-- Always visible at low opacity; full opacity on hover. -->
				<button
					onclick={copy}
					aria-label={copied ? 'Copied' : 'Copy message'}
					class="absolute top-2 right-2 p-1 rounded
					       text-stone-500 hover:text-stone-200 hover:bg-white/8
					       opacity-35 group-hover:opacity-100 transition-opacity duration-150"
				>
					{#if copied}
						<!-- Checkmark -->
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 6 9 17l-5-5"/>
						</svg>
					{:else}
						<!-- Clipboard copy -->
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
							<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
						</svg>
					{/if}
				</button>
			{/if}
		</div>
	</div>
{/if}
