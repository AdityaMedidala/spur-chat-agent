<script lang="ts">
	let {
		onsubmit,
		disabled = false,
		value = $bindable('')
	}: {
		onsubmit: (text: string) => void;
		disabled?: boolean;
		value?: string;
	} = $props();

	let textareaEl: HTMLTextAreaElement;

	const canSend = $derived(!disabled && value.trim().length > 0);

	function submit() {
		const text = value.trim();
		if (!text || disabled) return;
		value = '';
		if (textareaEl) textareaEl.style.height = 'auto';
		onsubmit(text);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	// Auto-resize on every value change, including external writes (chip clicks).
	$effect(() => {
		void value;
		if (textareaEl) {
			textareaEl.style.height = 'auto';
			textareaEl.style.height = `${textareaEl.scrollHeight}px`;
		}
	});
</script>

<div
	class="flex items-end gap-2 px-3 py-2.5
	       bg-stone-800/70 border border-white/10
	       rounded-2xl backdrop-blur-sm
	       focus-within:border-cyan-500/40 transition-colors duration-150"
>
	<textarea
		bind:this={textareaEl}
		bind:value
		onkeydown={onKeydown}
		placeholder="Type a message…"
		rows="1"
		{disabled}
		class="flex-1 bg-transparent border-0 outline-none resize-none
		       text-sm text-stone-100 placeholder:text-stone-500
		       leading-relaxed max-h-40 py-1 px-1
		       disabled:opacity-50"
	></textarea>

	<button
		onclick={submit}
		disabled={!canSend}
		aria-label="Send message"
		class="flex-none w-8 h-8 flex items-center justify-center rounded-xl
		       transition-colors duration-150
		       {canSend
			? 'bg-cyan-500 hover:bg-cyan-400 text-stone-900 cursor-pointer'
			: 'bg-white/5 text-stone-600 cursor-not-allowed'}"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</svg>
	</button>
</div>
