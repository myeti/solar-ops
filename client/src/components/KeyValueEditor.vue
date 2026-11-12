<template>
  <div class="kv-editor">
    <div v-if="rows.length === 0" class="kv-editor-empty text-faint small">No custom variable yet.</div>
    <div v-for="(row, index) in rows" :key="row.id" class="kv-editor-row">
      <input
        v-model="row.key"
        class="input mono kv-editor-key"
        placeholder="NAME"
        spellcheck="false"
        autocomplete="off"
        @input="onKeyInput(row)"
      />
      <span class="kv-editor-equals">=</span>
      <div class="kv-editor-value" :class="{ 'can-generate': canGenerate(row) }">
        <input
          v-model="row.value"
          class="input mono"
          :type="inputType(row)"
          placeholder="value"
          spellcheck="false"
          autocomplete="off"
          @input="emitChange"
        />
        <button
          v-if="canGenerate(row)"
          type="button"
          class="kv-editor-generate"
          :title="`Generate a random value (${GENERATED_LENGTH} characters)`"
          @click="generate(row)"
        >
          <FeatherIcon name="refresh-cw" :size="14" />
        </button>
      </div>
      <button
        v-if="isMasked(row)"
        type="button"
        class="btn btn-ghost btn-icon btn-sm"
        :title="maskTitle(row)"
        @click="row.revealed = !row.revealed"
      >
        <FeatherIcon :name="maskIcon(row)" :size="15" />
      </button>
      <span v-else class="kv-editor-placeholder"></span>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Remove" @click="remove(index)">
        <FeatherIcon name="trash-2" :size="15" />
      </button>
    </div>
    <div class="row">
      <button type="button" class="btn btn-sm" @click="add">
        <FeatherIcon name="plus" :size="15" />
        Add variable
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="showPaste = !showPaste">
        <FeatherIcon name="clipboard" :size="15" />
        Paste .env
      </button>
    </div>
    <div v-if="showPaste" class="stack-sm">
      <textarea
        v-model="pasted"
        class="textarea mono"
        placeholder="API_URL=https://api.example.com&#10;FEATURE_FLAG=true"
        spellcheck="false"
      ></textarea>
      <div class="row">
        <button type="button" class="btn btn-sm btn-primary" @click="importPasted">Import</button>
        <span class="tiny text-faint">Existing names are overwritten. Lines starting with # are ignored.</span>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * Editor for a list of environment variables: [{ key, value }].
 * Usable with v-model. Values are shown, except for names holding SECRET
 * or PASSWORD: masked (revealed on demand), and regenerated on demand
 * (random, GENERATED_LENGTH characters).
 */
let rowSequence = 0;

/** Names whose value is masked, and can be generated. */
const SECRET_NAME = /SECRET|PASSWORD/i;

const GENERATED_LENGTH = 32;

/** The alphabet of the server's generated secrets (no look-alike characters). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Random string from the browser's cryptographic generator. Bytes above
 * the largest multiple of the alphabet size are dropped (no bias).
 */
function randomSecret(length) {
  const limit = 256 - (256 % ALPHABET.length);
  let secret = '';

  while (secret.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && secret.length < length) {
        secret += ALPHABET[byte % ALPHABET.length];
      }
    }
  }

  return secret;
}

function makeRow(key, value) {
  rowSequence += 1;

  return { id: rowSequence, key, value, revealed: false };
}

export default {
  name: 'KeyValueEditor',
  props: {
    modelValue: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      GENERATED_LENGTH,
      rows: [],
      showPaste: false,
      pasted: '',
    };
  },
  watch: {
    modelValue: {
      immediate: true,
      handler(list) {
        if (this.sameAsRows(list)) {
          return;
        }

        this.rows = list.map((entry) => makeRow(entry.key, entry.value));
      },
    },
  },
  methods: {
    sameAsRows(list) {
      if (list.length !== this.rows.length) {
        return false;
      }

      return list.every((entry, index) => {
        return entry.key === this.rows[index].key && entry.value === this.rows[index].value;
      });
    },
    emitChange() {
      const list = this.rows.map((row) => ({ key: row.key, value: row.value }));
      this.$emit('update:modelValue', list);
    },
    onKeyInput(row) {
      row.key = row.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      this.emitChange();
    },
    add() {
      this.rows.push(makeRow('', ''));
      this.emitChange();
    },
    remove(index) {
      this.rows.splice(index, 1);
      this.emitChange();
    },
    isMasked(row) {
      return SECRET_NAME.test(row.key);
    },
    canGenerate(row) {
      return SECRET_NAME.test(row.key);
    },
    generate(row) {
      row.value = randomSecret(GENERATED_LENGTH);
      this.emitChange();
    },
    inputType(row) {
      if (!this.isMasked(row) || row.revealed) {
        return 'text';
      }

      return 'password';
    },
    maskIcon(row) {
      if (row.revealed) {
        return 'eye-off';
      }

      return 'eye';
    },
    maskTitle(row) {
      if (row.revealed) {
        return 'Hide value';
      }

      return 'Show value';
    },
    /**
     * Parse KEY=VALUE lines (optionally quoted values, `export` prefix).
     */
    importPasted() {
      const lines = this.pasted.split('\n');

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line === '' || line.startsWith('#') || !line.includes('=')) {
          continue;
        }

        const separator = line.indexOf('=');
        const key = line
          .slice(0, separator)
          .replace(/^export\s+/, '')
          .trim();
        let value = line.slice(separator + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        const existing = this.rows.find((row) => row.key === key);

        if (existing) {
          existing.value = value;
        } else {
          this.rows.push(makeRow(key, value));
        }
      }

      this.pasted = '';
      this.showPaste = false;
      this.emitChange();
    },
  },
};
</script>

<style>
.kv-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kv-editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kv-editor-key {
  max-width: 260px;
}

.kv-editor-equals {
  color: var(--text-faint);
  font-family: var(--font-mono);
}

.kv-editor-value {
  position: relative;
  flex: 1;
  min-width: 0;
}

.kv-editor-value .input {
  width: 100%;
}

.kv-editor-value.can-generate .input {
  padding-right: 38px;
}

/* Inside the value field, on its right. */
.kv-editor-generate {
  position: absolute;
  top: 50%;
  right: 6px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: var(--text-faint);
  background: transparent;
  cursor: pointer;
  transform: translateY(-50%);
}

.kv-editor-generate:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

/* Keeps the remove buttons aligned when a row has no mask toggle. */
.kv-editor-placeholder {
  flex-shrink: 0;
  width: 28px;
}

.kv-editor-empty {
  padding: 6px 0;
}
</style>
