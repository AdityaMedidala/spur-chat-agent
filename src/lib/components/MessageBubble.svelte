<script lang="ts">
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	let { sender, text }: { sender: 'user' | 'ai'; text: string } = $props();

	function renderMarkdown(content: string): string {
		const html = marked.parse(content, { async: false }) as string;
		return browser ? DOMPurify.sanitize(html) : html;
	}
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
	<div class="flex justify-start">
		<div
			class="max-w-[75%] px-4 py-3 rounded-3xl rounded-bl-sm
			       bg-stone-800/90 border border-white/8 border-l-2 border-l-cyan-500/50
			       text-stone-100 text-sm leading-relaxed ai-prose"
		>
			{@html renderMarkdown(text)}
		</div>
	</div>
{/if}
