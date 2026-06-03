<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import MessageBubble from '$lib/components/MessageBubble.svelte';
	import TypingIndicator from '$lib/components/TypingIndicator.svelte';
	import InputBar from '$lib/components/InputBar.svelte';

	let { data }: { data: PageData } = $props();

	type Message = { id: string; sender: 'user' | 'ai'; text: string; isError?: boolean };

	// untrack: read initial server data once without registering a reactive
	// dependency on `data`. These are independently managed after mount, so
	// we don't want Svelte re-initialising them if the prop reference changes.
	let messages: Message[] = $state(untrack(() => (data.messages as Message[]) ?? []));
	let sessionId: string | null = $state(untrack(() => data.sessionId ?? null));
	let loading = $state(false);
	// null   → not streaming (show typing indicator when loading)
	// string → streaming in progress (show live bubble)
	let streamingText = $state<string | null>(null);
	let inputValue = $state('');

	let bottomEl: HTMLDivElement;

	$effect(() => {
		void messages.length;
		void loading;
		void streamingText;
		// Use instant scroll during streaming so it keeps up with new tokens;
		// smooth scroll for all other state changes.
		bottomEl?.scrollIntoView({ behavior: streamingText !== null ? 'instant' : 'smooth' });
	});

	async function send(text: string) {
		messages = [...messages, { id: crypto.randomUUID(), sender: 'user', text }];
		loading = true;

		try {
			const res = await fetch('/chat/message', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text, sessionId })
			});

			if (!res.ok) {
				// Non-2xx responses (rate limit, validation, 500) return JSON.
				let errorText = 'Something went wrong. Please try again.';
				try {
					const j = await res.json();
					errorText = j.error ?? errorText;
				} catch { /* keep default */ }
				messages = [
					...messages,
					{ id: crypto.randomUUID(), sender: 'ai', text: errorText, isError: true }
				];
				return;
			}

			// 200 → SSE stream. Read token-by-token, accumulate into streamingText.
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				// SSE events are separated by double newline.
				const parts = buffer.split('\n\n');
				buffer = parts.pop()!; // last slice may be incomplete
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data: ')) continue;
					let event: {
						type: string;
						text?: string;
						html?: string;
						sessionId?: string;
						message?: string;
					};
					try {
						event = JSON.parse(line.slice(6));
					} catch {
						continue;
					}

					if (event.type === 'token') {
						streamingText = (streamingText ?? '') + (event.text ?? '');
					} else if (event.type === 'done') {
						// Swap streaming bubble for final rendered HTML.
						sessionId = event.sessionId ?? sessionId;
						messages = [
							...messages,
							{ id: crypto.randomUUID(), sender: 'ai', text: event.html ?? '' }
						];
						streamingText = null;
						break outer;
					} else if (event.type === 'error') {
						messages = [
							...messages,
							{
								id: crypto.randomUUID(),
								sender: 'ai',
								text:
									event.message ?? 'Something went wrong. Please try again.',
								isError: true
							}
						];
						streamingText = null;
						break outer;
					}
				}
			}
		} catch {
			streamingText = null;
			messages = [
				...messages,
				{
					id: crypto.randomUUID(),
					sender: 'ai',
					text: "I couldn't reach the server. Please check your connection and try again.",
					isError: true
				}
			];
		} finally {
			loading = false;
			streamingText = null;
		}
	}

	async function retry(errorId: string) {
		if (loading) return;
		const errorIdx = messages.findIndex((m) => m.id === errorId);
		if (errorIdx === -1) return;
		// Find the user message immediately preceding this error.
		let lastUserIdx = -1;
		for (let i = errorIdx - 1; i >= 0; i--) {
			if (messages[i].sender === 'user') { lastUserIdx = i; break; }
		}
		if (lastUserIdx === -1) return;
		const textToRetry = messages[lastUserIdx].text;
		// Drop both the error and the preceding user turn; send() re-adds the user message.
		messages = messages.filter((_, i) => i !== errorIdx && i !== lastUserIdx);
		await send(textToRetry);
	}

	async function startNewChat() {
		// Delete the cookie server-side first. If this fails (e.g. offline),
		// we still clear local state — the cookie will be overwritten on the
		// next send, and the old conversation won't resurface in this tab.
		try {
			await fetch('/chat/new', { method: 'POST' });
		} catch {
			// network failure — proceed anyway, local state still clears
		}
		messages = [];
		sessionId = null;
		inputValue = '';
	}

	function fillPrompt(text: string) {
		inputValue = text;
	}

	const SUGGESTED_PROMPTS = [
		"What's your return policy?",
		'Do you ship internationally?',
		'What are your support hours?'
	];
</script>

<svelte:head>
	<title>Aria — Support Chat</title>
</svelte:head>

<!-- Single cohesive surface: one dark background, no panels or shadows. -->
<!-- Structure: top accent → pinned header → scrolling message area → pinned input bar. -->
<!-- Content inside each full-width bar is constrained to max-w-3xl.       -->
<div class="flex flex-col h-dvh bg-[#1b1916] text-stone-100">

	<!-- ── Top accent line ──────────────────────────────────────────────────── -->
	<!-- Single restrained accent: a 1px gradient at the very top of the page. -->
	<div class="h-px flex-none bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>

	<!-- ── Header bar ────────────────────────────────────────────────────────── -->
	<header class="flex-none border-b border-white/[0.07]">
		<div class="max-w-3xl mx-auto w-full px-4 sm:px-6 py-3.5 flex items-center justify-between">
			<div class="flex items-center gap-2.5">
				<div
					class="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/25 to-blue-600/25
					       border border-cyan-500/30 flex items-center justify-center"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#67e8f9"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold tracking-wide">Aria</span>
					<span class="flex items-center gap-1.5 text-xs text-stone-500">
						<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
						Maple &amp; Co. Support
					</span>
				</div>
			</div>
			<button
				onclick={startNewChat}
				class="text-xs text-stone-500 hover:text-stone-200 transition-colors
				       px-2.5 py-1 rounded-lg hover:bg-white/5"
			>
				New chat
			</button>
		</div>
	</header>

	<!-- ── Message area ───────────────────────────────────────────────────────── -->
	<!-- min-h-0 lets the flex child shrink so overflow-y-auto actually fires.   -->
	<div class="flex-1 min-h-0 overflow-y-auto">
		<div class="max-w-3xl mx-auto w-full px-4 sm:px-6">

			{#if messages.length === 0 && !loading}
				<!-- Empty state: anchored slightly above centre via top padding. -->
				<!-- Each child animates in staggered (0 / 80 / 160 ms) via CSS.  -->
				<div class="flex flex-col items-center gap-4 text-center pt-[15vh] sm:pt-[20vh] pb-8">
					<div
						class="w-10 h-10 rounded-2xl
						       bg-gradient-to-br from-cyan-500/20 to-blue-600/20
						       border border-cyan-500/25 flex items-center justify-center"
						style="animation: fade-slide-up 0.38s ease both, logo-pulse 3s ease-in-out 0.5s infinite;"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#67e8f9"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</div>
					<div style="animation: fade-slide-up 0.38s 80ms ease both; opacity: 0;">
						<p class="text-sm font-medium text-stone-200 mb-1">Hi, I'm Aria</p>
						<p class="text-xs text-stone-500 max-w-[20rem]">
							Your Maple &amp; Co. support agent. Ask me anything about
							orders, shipping, or returns.
						</p>
					</div>
					<div
						class="flex flex-wrap justify-center gap-2 max-w-xs sm:max-w-sm"
						style="animation: fade-slide-up 0.38s 160ms ease both; opacity: 0;"
					>
						{#each SUGGESTED_PROMPTS as prompt (prompt)}
							<button
								onclick={() => fillPrompt(prompt)}
								class="text-xs px-3 py-1.5 rounded-full leading-snug
								       border border-stone-700 text-stone-400
								       hover:border-cyan-500/50 hover:text-stone-200 hover:bg-cyan-500/5
								       hover:-translate-y-px transition duration-150"
							>
								{prompt}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<!-- role="log" implies aria-live="polite"; screen readers announce new entries. -->
				<div class="flex flex-col gap-3 py-6" role="log" aria-live="polite" aria-label="Conversation">
					{#each messages as msg (msg.id)}
						<!-- User bubbles: fly up + scale spring (scale handled in MessageBubble). -->
						<!-- AI replies: gentler fade-in to contrast with the typing indicator swap. -->
						{#if msg.sender === 'user'}
							<div in:fly={{ y: 6, duration: 200, easing: cubicOut }}>
								<MessageBubble sender={msg.sender} text={msg.text} />
							</div>
						{:else}
							<div in:fade={{ duration: 280 }}>
								<MessageBubble sender={msg.sender} text={msg.text} isError={msg.isError} />
								{#if msg.isError && !loading}
									<!-- Retry button: always visible on error, hidden while a request is in flight. -->
									<div class="mt-1.5 ml-1">
										<button
											onclick={() => retry(msg.id)}
											class="flex items-center gap-1 text-xs text-stone-500
											       hover:text-stone-300 transition-colors duration-150"
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
												<path d="M3 3v5h5"/>
											</svg>
											Retry
										</button>
									</div>
								{/if}
							</div>
						{/if}
					{/each}

					<!-- Typing indicator: shown until the first token arrives. -->
					{#if loading && streamingText === null}
						<div
							in:fly={{ y: 8, duration: 200, easing: cubicOut }}
							out:fade={{ duration: 150 }}
						>
							<TypingIndicator />
						</div>
					{/if}

					<!-- Streaming bubble: live text with blinking cursor.              -->
					<!-- Fades out as the final rendered-HTML bubble fades in on 'done'. -->
					{#if streamingText !== null}
						<div
							in:fade={{ duration: 120 }}
							out:fade={{ duration: 150 }}
							class="flex justify-start"
						>
							<div
								class="max-w-[75%] px-4 py-3 rounded-3xl rounded-bl-sm
								       bg-stone-800/90 border border-white/[0.08] border-l-2 border-l-cyan-500/50
								       text-stone-100 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{streamingText}<span
									class="inline-block w-px h-3.5 ml-0.5 bg-cyan-400 align-middle"
									style="animation: cursor-blink 1s step-end infinite;"
								></span>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<div bind:this={bottomEl}></div>
		</div>
	</div>

	<!-- ── Input bar ──────────────────────────────────────────────────────────── -->
	<div class="flex-none border-t border-white/[0.07]">
		<div class="max-w-3xl mx-auto w-full px-4 sm:px-6 py-3 sm:py-4">
			<InputBar onsubmit={send} disabled={loading} bind:value={inputValue} />
			<p class="text-center text-xs text-stone-600 mt-2">
				Maple &amp; Co. · Mon–Fri 9 AM–6 PM ET · support@mapleandco.com
			</p>
		</div>
	</div>

</div>
