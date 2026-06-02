<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import MessageBubble from '$lib/components/MessageBubble.svelte';
	import TypingIndicator from '$lib/components/TypingIndicator.svelte';
	import InputBar from '$lib/components/InputBar.svelte';

	let { data }: { data: PageData } = $props();

	type Message = { id: string; sender: 'user' | 'ai'; text: string };

	// untrack: read initial server data once without registering a reactive
	// dependency on `data`. These are independently managed after mount, so
	// we don't want Svelte re-initialising them if the prop reference changes.
	let messages: Message[] = $state(untrack(() => (data.messages as Message[]) ?? []));
	let sessionId: string | null = $state(untrack(() => data.sessionId ?? null));
	let loading = $state(false);
	let inputValue = $state('');

	let bottomEl: HTMLDivElement;

	$effect(() => {
		void messages.length;
		void loading;
		bottomEl?.scrollIntoView({ behavior: 'smooth' });
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

			const json = await res.json();

			if (!res.ok) {
				messages = [
					...messages,
					{
						id: crypto.randomUUID(),
						sender: 'ai',
						text: json.error ?? 'Something went wrong. Please try again.'
					}
				];
			} else {
				sessionId = json.sessionId;
				messages = [...messages, { id: crypto.randomUUID(), sender: 'ai', text: json.reply }];
			}
		} catch {
			messages = [
				...messages,
				{
					id: crypto.randomUUID(),
					sender: 'ai',
					text: "I couldn't reach the server. Please check your connection and try again."
				}
			];
		} finally {
			loading = false;
		}
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
<!-- Structure: pinned header → scrolling message area → pinned input bar. -->
<!-- Content inside each full-width bar is constrained to max-w-3xl.       -->
<div class="flex flex-col h-dvh bg-[#1b1916] text-stone-100">

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
				<div class="flex flex-col items-center gap-4 text-center pt-[15vh] sm:pt-[20vh] pb-8">
					<div
						class="w-10 h-10 rounded-2xl
						       bg-gradient-to-br from-cyan-500/20 to-blue-600/20
						       border border-cyan-500/25 flex items-center justify-center"
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
					<div>
						<p class="text-sm font-medium text-stone-200 mb-1">Hi, I'm Aria</p>
						<p class="text-xs text-stone-500 max-w-[20rem]">
							Your Maple &amp; Co. support agent. Ask me anything about
							orders, shipping, or returns.
						</p>
					</div>
					<div class="flex flex-wrap justify-center gap-2 max-w-xs sm:max-w-sm">
						{#each SUGGESTED_PROMPTS as prompt (prompt)}
							<button
								onclick={() => fillPrompt(prompt)}
								class="text-xs px-3 py-1.5 rounded-full leading-snug
								       border border-stone-700 text-stone-400
								       hover:border-cyan-500/50 hover:text-stone-200 hover:bg-cyan-500/5
								       transition-colors duration-150"
							>
								{prompt}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-3 py-6">
					{#each messages as msg (msg.id)}
						<div in:fly={{ y: 8, duration: 250, easing: cubicOut }}>
							<MessageBubble sender={msg.sender} text={msg.text} />
						</div>
					{/each}

					{#if loading}
						<div in:fly={{ y: 8, duration: 200, easing: cubicOut }}>
							<TypingIndicator />
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
