<script lang="ts">
	let { label, value, type = 'text', placeholder = '', onSave }: {
		label: string;
		value: string;
		type?: string;
		placeholder?: string;
		onSave: (value: string) => void;
	} = $props();

	let inputValue = $state(value);
	let showPassword = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Sync from parent when value changes
	$effect(() => {
		inputValue = value;
	});

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		inputValue = target.value;

		// Debounce save
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			if (inputValue !== value) {
				onSave(inputValue);
			}
		}, 800);
	}

	function handleBlur() {
		if (timer) clearTimeout(timer);
		if (inputValue !== value) {
			onSave(inputValue);
		}
	}
</script>

<div class="form-control w-full">
	<label class="label py-1">
		<span class="label-text text-xs">{label}</span>
	</label>
	<div class="relative">
		<input
			type={type === 'password' && !showPassword ? 'password' : 'text'}
			class="input input-bordered input-sm w-full pr-10"
			{placeholder}
			value={inputValue}
			oninput={handleInput}
			onblur={handleBlur}
		/>
		{#if type === 'password'}
			<button
				type="button"
				class="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content/70 text-xs"
				onclick={() => showPassword = !showPassword}
			>
				{showPassword ? 'hide' : 'show'}
			</button>
		{/if}
	</div>
</div>
