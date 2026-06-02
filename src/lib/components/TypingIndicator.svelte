<div class="flex justify-start">
	<div
		class="flex items-center gap-1.5 px-4 py-3.5 rounded-3xl rounded-bl-sm
		       bg-stone-800/90 border border-white/8 border-l-2 border-l-cyan-500/50"
		aria-label="Agent is typing"
	>
		{#each [0, 1, 2] as i (i)}
			<span
				class="block w-1.5 h-1.5 rounded-full bg-cyan-400/80"
				style="animation: typing-bounce 1.2s ease-in-out {i * 0.2}s infinite"
			></span>
		{/each}
	</div>
</div>
