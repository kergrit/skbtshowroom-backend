import {AmeCustomizable} from '../pro-customizables/assets/customizable.js';

export namespace AmeStyleGenerator {
	const $ = jQuery;

	//region Values
	interface ValueDescriptorData {
		t: 'constant' | 'setting' | 'funcCall' | 'var' | 'array';
	}

	interface ConstantValueData extends ValueDescriptorData {
		t: 'constant';
		value: string;
	}

	interface ArrayValueData extends ValueDescriptorData {
		t: 'array';
		items: AnyValueDescriptorData[];
	}

	interface SettingReferenceData extends ValueDescriptorData {
		t: 'setting';
		id: string;
	}

	interface FunctionCallData extends ValueDescriptorData {
		t: 'funcCall';
		name: string;
		args: AnyValueDescriptorData[] | Record<string, AnyValueDescriptorData>;
	}

	interface VariableReferenceData extends ValueDescriptorData {
		t: 'var';
		name: string;
	}

	type AnyValueDescriptorData =
		ConstantValueData
		| SettingReferenceData
		| FunctionCallData
		| VariableReferenceData
		| ArrayValueData;

	abstract class ValueDescriptor {
		abstract getValue(): any | null;
	}

	class ConstantValue extends ValueDescriptor {
		constructor(protected readonly value: string) {
			super();
		}

		getValue() {
			return this.value;
		}
	}

	class ArrayValue extends ValueDescriptor {
		constructor(protected readonly items: ValueDescriptor[]) {
			super();
		}

		getValue() {
			return this.items.map(item => item.getValue());
		}

		getItemDescriptors() {
			return this.items;
		}
	}

	class SettingReference extends ValueDescriptor {
		constructor(
			public readonly settingId: string,
			protected readonly valueGetter: (id: string) => any
		) {
			super();
		}

		getValue() {
			return this.valueGetter(this.settingId);
		}
	}

	class VariableReference extends ValueDescriptor {
		constructor(
			public readonly name: string,
			protected readonly valueGetter: (name: string) => any
		) {
			super();
		}

		getValue(): any {
			return this.valueGetter(this.name);
		}
	}

	type FunctionCallArgs = any[] | Record<string, any>;

	type BoxedFunctionCallArgs<A extends FunctionCallArgs> =
		A extends any[] ? ValueDescriptor[] : Record<string, ValueDescriptor>

	class FunctionCall<A extends FunctionCallArgs, R> extends ValueDescriptor {
		constructor(
			public readonly args: BoxedFunctionCallArgs<A>,
			protected readonly callback: (args: A) => R
		) {
			super();
		}

		getValue() {
			return this.callback(this.resolveArgs(this.args));
		}

		protected resolveArgs(args: BoxedFunctionCallArgs<A>): A {
			if (Array.isArray(args)) {
				return args.map(arg => arg.getValue()) as A;
			}

			return Object.keys(args).reduce((result, key) => {
				result[key] = args[key].getValue();
				return result;
			}, {} as Record<string, any>) as A;
		}
	}

	//endregion

	function isEmptyCssValue(value: string): boolean {
		return (typeof value === 'undefined') || (value === '') || (value === null);
	}

	function convertToRgba(color: string, opacity: number = 1.0): string {
		color = color.trim();
		if (color === '') {
			return 'transparent';
		}

		//Strip the leading hash, if any.
		if (color[0] === '#') {
			color = color.substring(1);
		}

		//If the color is in the shorthand format, expand it.
		if (color.length === 3) {
			color = color[0] + color[0] + color[1] + color[1] + color[2] + color[2];
		}

		//The color should now be in the full 6-digit format. Convert it to RGBA.
		if (color.length === 6) {
			const red = parseInt(color.substring(0, 2), 16);
			const green = parseInt(color.substring(2, 4), 16);
			const blue = parseInt(color.substring(4, 6), 16);
			return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
		}

		//The color may be invalid, or it's not in a hex format we recognize.
		return color;
	}

	function uniqueArrayValues<T>(array: T[]): T[] {
		return array.filter((value, index) => array.indexOf(value) === index);
	}

	// noinspection JSUnusedGlobalSymbols -- Used dynamically by declaration generators received from the server.
	const builtinFunctions = {
		simpleProperty: function (args: { name: string | null, value: string | null }): string[] {
			if (isEmptyCssValue(args.value)) {
				return [];
			}
			return [args.name + ': ' + args.value + ';'];
		},

		formatLength: function (args: { value: string | null, unit: string | null }): string {
			if (isEmptyCssValue(args.value)) {
				return '';
			}
			return '' + args.value + (args.unit || '');
		},

		shadow: function (args: Record<string, any>): string[] {
			const mode = args.mode || 'default';
			const color = args.color || '';

			if (mode === 'default') {
				return [];
			}
			if ((mode === 'none') || (color === '') || (color === null) || (color === 'transparent')) {
				return ['box-shadow: none;'];
			}
			if (mode !== 'custom') {
				return [];
			}

			const components = [];
			if (args.inset) {
				components.push('inset');
			}

			const horizontal = args['offset-x'] || 0;
			const vertical = args['offset-y'] || 0;
			const blur = args.blur || 0;
			const spread = args.spread || 0;
			components.push(`${horizontal}px ${vertical}px ${blur}px ${spread}px`);

			const colorOpacity = args.colorOpacity || 1.0;
			if (colorOpacity < 1.0) {
				components.push(convertToRgba(color, colorOpacity));
			} else {
				components.push(color);
			}

			return [`box-shadow: ${components.join(' ')};`];
		},

		boxSides: function (args: Record<string, any>): string[] {
			if (typeof args.cssPropertyPrefix !== 'string') {
				throw new Error('Invalid config for the boxSides generator: missing cssPropertyPrefix');
			}

			const compositeValue = args.value || {};
			const unit = compositeValue.unit || '';

			const declarations = [];
			for (const side of ['top', 'right', 'bottom', 'left']) {
				const value = compositeValue[side];
				if (isEmptyCssValue(value)) {
					continue;
				}

				const property = args.cssPropertyPrefix + side;
				declarations.push(`${property}: ${value}${unit};`);
			}

			return declarations;
		},

		firstNonEmpty(args: any[]): any | null {
			for (const arg of args) {
				if (!isEmptyCssValue(arg)) {
					return arg;
				}
			}
			return null;
		},

		/**
		 * Take a HEX color, convert it to HSL to edit its components,
		 * then convert back to HEX.
		 *
		 * @param args
		 */
		editHexAsHsl: function (
			args: {
				color: string | null,
				hue?: number | null,
				saturation?: number | null,
				lightness?: number | null
			}
		): string {
			const color = args.color || '';
			if (isEmptyCssValue(color)) {
				return '';
			}

			const hue = args.hue || null;
			const saturation = args.saturation || null;
			const lightness = args.lightness || null;

			if ((hue === null) && (saturation === null) && (lightness === null)) {
				return color;
			}

			//WordPress includes the jquery-color library.
			let output = $.Color(color);
			if (hue !== null) {
				output = output.hue(hue);
			}
			if (saturation !== null) {
				output = output.saturation(saturation);
			}
			if (lightness !== null) {
				output = output.lightness(lightness);
			}
			return output.toHexString();
		},

		mixColors: function (args: { color1: string | null, color2: string | null, weight?: number | null }): string {
			const color1 = args.color1 || '';
			const color2 = args.color2 || '';
			if (isEmptyCssValue(color1) || isEmptyCssValue(color2)) {
				return '';
			}

			const weight = args.weight || 50;
			if (weight <= 0) {
				return color2;
			} else if (weight >= 100) {
				return color1;
			}

			return $.Color(color2).transition($.Color(color1), weight / 100).toHexString();
		},

		darken: function (args: { color: string | null, amount?: number | null }): string {
			const color = args.color || '';
			if (isEmptyCssValue(color)) {
				return '';
			}

			const amount = args.amount || 0;
			if (amount <= 0) {
				return color;
			}

			let output = $.Color(color);

			//Amount is a number between 0 and 100, while lightness is between 0.0 and 1.0.
			let newLightness = output.lightness() - (amount / 100);
			//Clamp to 0.0 - 1.0.
			newLightness = Math.max(0.0, Math.min(1.0, newLightness));

			return output.lightness(newLightness).toHexString();
		},

		compare: function <T, F>(
			args: { value1: any, value2: any, op: string, thenResult?: T, elseResult?: F }
		): T | F | boolean | null {
			const value1 = args.value1;
			const value2 = args.value2;
			const operator = args.op;
			const thenResult = (typeof args.thenResult !== 'undefined') ? args.thenResult : true;
			const elseResult = (typeof args.elseResult !== 'undefined') ? args.elseResult : null;
			let result: any;

			switch (operator) {
				case '==':
					result = value1 == value2;
					break;
				case '!=':
					result = value1 != value2;
					break;
				case '>':
					result = value1 > value2;
					break;
				case '>=':
					result = value1 >= value2;
					break;
				case '<':
					result = value1 < value2;
					break;
				case '<=':
					result = value1 <= value2;
					break;
				default:
					throw new Error(`Unknown operator: ${operator}`);
			}

			return result ? thenResult : elseResult;
		},

		ifSome: function (args: { values: any[], thenResult: any, elseResult?: any }): any {
			const values = args.values;
			const thenResult = args.thenResult;
			const elseResult = (typeof args.elseResult !== 'undefined') ? args.elseResult : null;

			for (const value of values) {
				if (!!value) {
					return thenResult;
				}
			}
			return elseResult;
		},

		ifAll: function (args: { values: any[], thenResult: any, elseResult?: any }): any {
			const values = args.values;
			const thenResult = args.thenResult;
			const elseResult = args.elseResult !== undefined ? args.elseResult : null;

			if (!values || (values.length === 0)) {
				return elseResult;
			}

			for (const value of values) {
				if (!value) {
					return elseResult;
				}
			}
			return thenResult;
		}
	}

	export namespace Preview {
		import SettingValueReader = AmeCustomizable.SettingValueReader;
		const $ = jQuery;

		interface CssRuleSetConfig {
			selectors: string[];
			generators: AnyValueDescriptorData[];
		}

		export interface StyleGeneratorPreviewConfig {
			ruleSets: CssRuleSetConfig[];
			conditions: Array<{
				expression: AnyValueDescriptorData;
				ruleSets: CssRuleSetConfig[];
			}>;
			variables: Record<string, AnyValueDescriptorData>;
			stylesheetsToDisable?: string[];
			previewAllOnFirstUpdate?: boolean;
		}

		const inactiveSettingMarker = {'_ame_inactive_setting': true};

		class PreviewSession {

			private readonly settings: Record<string, KnockoutObservable<any>> = {};
			private readonly valueReaders: Set<SettingValueReader> = new Set();
			private readonly notFound = {};

			private readonly variables: Record<string, ValueDescriptor> = {};
			private readonly styleBlocks: PreviewStyleBlock[] = [];

			private readonly stylesheetsToDisable: string[] = [];
			private stylesheetWasEnabled: Record<string, boolean> = {};

			private readonly settingValueGetter: (settingId: string) => any;
			private readonly variableValueGetter: (variableName: string) => any;

			/**
			 * Whether this is the first time the preview is being updated.
			 * This is set to false after preview() is called for the first time.
			 */
			private _isBeforeFirstUpdate: boolean = true;

			constructor(config: StyleGeneratorPreviewConfig) {
				//Optimization: Create bound getters once instead of every time we need
				//to create a setting or variable reference.
				this.settingValueGetter = this.getSettingPreviewValue.bind(this);
				this.variableValueGetter = (variableName: string) => {
					if (variableName in this.variables) {
						return this.variables[variableName].getValue();
					}
					return null;
				}

				//Optionally, disable already generated custom stylesheets while the preview
				//is active to prevent old settings from interfering with the preview of new settings.
				if (Array.isArray(config.stylesheetsToDisable)) {
					this.stylesheetsToDisable = config.stylesheetsToDisable;
				}

				//Variables
				for (const variableName in config.variables) {
					if (!config.variables.hasOwnProperty(variableName)) {
						continue;
					}
					this.variables[variableName] = this.createValueDescriptor(
						config.variables[variableName],
						true
					);
				}

				//Rule sets
				for (const ruleset of this.createRuleSets(config.ruleSets)) {
					this.styleBlocks.push(new PreviewStyleBlock([ruleset]));
				}

				//Conditional rule sets
				for (const conditionConfig of config.conditions) {
					const ruleSets = this.createRuleSets(conditionConfig.ruleSets);
					if (ruleSets.length < 1) {
						continue;
					}

					const condition = this.createValueDescriptor(conditionConfig.expression, true);
					const usedSettingIds = this.getSettingIdsUsedBy(condition);
					const conditionCallback = (): boolean => {
						//For performance, conditions that reference settings should
						//only be checked when at least one setting is active.
						if (usedSettingIds.length > 0) {
							if (!usedSettingIds.some((id) => this.isSettingActive(id))) {
								return false;
							}
						}

						const isTruthy = condition.getValue();
						return !!isTruthy; //Convert to boolean.
					};

					this.styleBlocks.push(new PreviewStyleBlock(ruleSets, conditionCallback));
				}
			}

			private createValueDescriptor(
				data: AnyValueDescriptorData,
				allowUnknownVariables: boolean = false
			): ValueDescriptor {
				switch (data.t) {
					case 'constant':
						return new ConstantValue(data.value);
					case 'array':
						return new ArrayValue(data.items.map(
							(valueData) => this.createValueDescriptor(valueData, allowUnknownVariables)
						));
					case 'setting':
						this.registerPreviewableSettingId(data.id);
						return new SettingReference(data.id, this.settingValueGetter);
					case 'var':
						if (!this.variables.hasOwnProperty(data.name) && !allowUnknownVariables) {
							throw new Error('Unknown variable: ' + data.name);
						}
						return new VariableReference(data.name, this.variableValueGetter);
					case 'funcCall':
						if (!builtinFunctions.hasOwnProperty(data.name)) {
							throw new Error('Unknown function: ' + data.name);
						}
						const func = builtinFunctions[data.name];
						//Initialize the function arguments.
						let args;
						if (Array.isArray(data.args)) {
							args = data.args.map(arg => this.createValueDescriptor(arg, allowUnknownVariables));
						} else {
							args = {};
							for (const argName in data.args) {
								if (!data.args.hasOwnProperty(argName)) {
									continue;
								}
								args[argName] = this.createValueDescriptor(data.args[argName], allowUnknownVariables);
							}
						}
						return new FunctionCall(args, func);
				}
			}

			/**
			 * Get the IDs of all settings that are referenced by the given descriptor.
			 *
			 * @param descriptor
			 * @private
			 */
			private getSettingIdsUsedBy(descriptor: ValueDescriptor): string[] {
				if (descriptor instanceof SettingReference) {
					return [descriptor.settingId];
				}

				if (descriptor instanceof ArrayValue) {
					let result = [];
					for (const item of descriptor.getItemDescriptors()) {
						result = result.concat(this.getSettingIdsUsedBy(item));
					}
					return uniqueArrayValues(result);
				}

				if (descriptor instanceof FunctionCall) {
					let result = [];
					const args = descriptor.args;
					if (Array.isArray(args)) {
						for (const arg of args) {
							result = result.concat(this.getSettingIdsUsedBy(arg));
						}
					} else {
						for (const argName in args) {
							if (args.hasOwnProperty(argName)) {
								result = result.concat(this.getSettingIdsUsedBy(args[argName]));
							}
						}
					}
					return uniqueArrayValues(result);
				}

				if (descriptor instanceof VariableReference) {
					const varDef = this.getVariableDefinition(descriptor.name);
					if (varDef === null) {
						return [];
					}
					return this.getSettingIdsUsedBy(varDef);
				}

				return [];
			}

			public getVariableDefinition(variableName: string): ValueDescriptor | null {
				if (!this.variables.hasOwnProperty(variableName)) {
					return null;
				}
				return this.variables[variableName];
			}

			private createRuleSets(configs: CssRuleSetConfig[]): CssRuleSet[] {
				let results = [];
				for (const config of configs) {
					const generatorWrappers = this.makeGeneratorWrappers(config.generators);
					if (generatorWrappers.length < 1) {
						continue;
					}
					results.push(new CssRuleSet(config.selectors, generatorWrappers));
				}
				return results;
			}

			getPreviewableSettingIDs(): string[] {
				return Object.keys(this.settings);
			}

			preview(settingId: string, value: any, otherSettingReader: SettingValueReader): void {
				if (this._isBeforeFirstUpdate) {
					this._isBeforeFirstUpdate = false;
					this.disableAssociatedStylesheets();
				}

				this.valueReaders.add(otherSettingReader);

				if (!this.settings.hasOwnProperty(settingId)) {
					this.settings[settingId] = ko.observable(value);
				} else {
					this.settings[settingId](value);
				}
			}

			dispose(): void {
				//Dispose of all style blocks.
				for (const block of this.styleBlocks) {
					block.dispose();
				}

				this.reEnableAssociatedStylesheets();
			}

			private disableAssociatedStylesheets() {
				for (const stylesheetSelector of this.stylesheetsToDisable) {
					const $link = $(stylesheetSelector);
					if ($link.length > 0) {
						this.stylesheetWasEnabled[stylesheetSelector] = $link.prop('disabled');
						$link.prop('disabled', true);
					}
				}
			}

			private reEnableAssociatedStylesheets() {
				for (const stylesheetSelector of this.stylesheetsToDisable) {
					const $link = $(stylesheetSelector);
					if (($link.length > 0) && this.stylesheetWasEnabled.hasOwnProperty(stylesheetSelector)) {
						$link.prop('disabled', this.stylesheetWasEnabled[stylesheetSelector]);
					}
				}
			}

			isSettingActive(settingId: string): boolean {
				if (this.settings.hasOwnProperty(settingId)) {
					return this.settings[settingId]() !== inactiveSettingMarker;
				}
				return false;
			}

			getSettingPreviewValue(settingId: string): any {
				if (!this.settings.hasOwnProperty(settingId)) {
					const value = this.getSettingFromReaders(settingId);
					this.settings[settingId] = ko.observable(value).extend({deferred: true});
				}

				const observable = this.settings[settingId];
				let value = observable();
				if (value === inactiveSettingMarker) {
					value = this.getSettingFromReaders(settingId);
					observable(value);
				}
				return value;
			}

			private getSettingFromReaders(settingId: string): any {
				for (const reader of this.valueReaders) {
					const value = reader(settingId, this.notFound);
					if (value !== this.notFound) {
						return value;
					}
				}
				throw new Error('Setting not found for preview: ' + settingId);
			}

			private makeGeneratorWrappers(generatorConfigs: AnyValueDescriptorData[]): DeclarationGeneratorWrapper[] {
				let generatorWrappers = [];
				for (const generatorConfig of generatorConfigs) {
					const wrapper = this.makeDeclarationGeneratorWrapper(generatorConfig);
					if (wrapper !== null) {
						generatorWrappers.push(wrapper);
					}
				}
				return generatorWrappers;
			}

			private makeDeclarationGeneratorWrapper(config: AnyValueDescriptorData): DeclarationGeneratorWrapper | null {
				const generator = this.createValueDescriptor(config);
				return new DeclarationGeneratorWrapper(generator, this);
			}

			private registerPreviewableSettingId(settingId: string): void {
				if (!this.settings.hasOwnProperty(settingId)) {
					this.settings[settingId] = ko.observable(inactiveSettingMarker);
				}
			}

			get isBeforeFirstUpdate(): boolean {
				return this._isBeforeFirstUpdate;
			}
		}

		/**
		 * Preview manager for the style generator.
		 *
		 * This is a thin wrapper around the PreviewSession class. It initializes the session
		 * as needed and destroys it when the preview is cleared. This makes it simpler to manage
		 * active settings, style blocks, and CSS rule-sets: instead of having to carefully
		 * track dependencies and deactivate/reactivate them in the right order whenever the preview
		 * is disabled/enabled, we can just destroy the session and start over.
		 */
		export class StyleGeneratorPreview implements AmeCustomizable.PreviewUpdater {
			private currentSession: PreviewSession | null = null;

			constructor(private readonly config: StyleGeneratorPreviewConfig) {
			}

			private getOrCreateSession(): PreviewSession {
				if (this.currentSession === null) {
					this.currentSession = new PreviewSession(this.config);
				}
				return this.currentSession;
			}

			getPreviewableSettingIDs(): string[] {
				return this.getOrCreateSession().getPreviewableSettingIDs();
			}

			preview(settingId: string, value: any, otherSettingReader: SettingValueReader): void {
				const session = this.getOrCreateSession();

				const shouldPreviewAll = (this.config.previewAllOnFirstUpdate && session.isBeforeFirstUpdate);
				session.preview(settingId, value, otherSettingReader);

				if (shouldPreviewAll) {
					//Preview all registered settings the first time the preview is updated.
					const notFound = {};
					for (const otherId of session.getPreviewableSettingIDs()) {
						const otherValue = otherSettingReader(otherId, notFound);
						if ((otherId !== settingId) && (otherValue !== notFound)) {
							session.preview(otherId, otherValue, otherSettingReader);
						}
					}
				}
			}

			clearPreview(): void {
				if (this.currentSession !== null) {
					this.currentSession.dispose();
					this.currentSession = null;
				}
			}
		}

		interface DeclarationSource {
			isActive(): boolean;

			cssDeclarations(): string[];

			dispose(): void;
		}

		class DeclarationGeneratorWrapper implements DeclarationSource {
			public readonly cssDeclarations: KnockoutComputed<string[]>;
			private readonly usedSettingIds: string[];

			constructor(
				private readonly generator: ValueDescriptor,
				private readonly settingSource: PreviewSession
			) {
				//Introspect the generator and see which settings it uses.
				//This will be useful to determine if the generator is active.
				this.usedSettingIds = DeclarationGeneratorWrapper.findReferencedSettingIds(
					generator,
					settingSource
				);

				this.cssDeclarations = ko.computed({
					read: () => this.getDeclarations(),
					deferEvaluation: true,
				}).extend({deferred: true});
			}

			/**
			 * Recursively find all settings used by a value descriptor (such as a function call).
			 *
			 * @param {ValueDescriptor} thing
			 * @param variableSource Needed to get variable definitions and not just the final values.
			 */
			static findReferencedSettingIds(thing: ValueDescriptor, variableSource: PreviewSession): string[] {
				let settingIds: string[] = [];
				if (thing instanceof SettingReference) {
					settingIds.push(thing.settingId);
				} else if (thing instanceof FunctionCall) {
					if (Array.isArray(thing.args)) {
						for (const arg of thing.args) {
							settingIds = settingIds.concat(
								DeclarationGeneratorWrapper.findReferencedSettingIds(arg, variableSource)
							);
						}
					} else {
						for (const key in thing.args) {
							settingIds = settingIds.concat(
								DeclarationGeneratorWrapper.findReferencedSettingIds(thing.args[key], variableSource)
							);
						}
					}
				} else if (thing instanceof VariableReference) {
					const value = variableSource.getVariableDefinition(thing.name);
					if (value !== null) {
						settingIds = settingIds.concat(
							DeclarationGeneratorWrapper.findReferencedSettingIds(value, variableSource)
						);
					}
				}
				return settingIds;
			}

			isActive(): boolean {
				//Check if any of the input settings are active.
				let hasSettingLookups = false;
				for (const settingId of this.usedSettingIds) {
					hasSettingLookups = true;
					if (this.settingSource.isSettingActive(settingId)) {
						return true;
					}
				}

				//If there are no input settings, the generator is always active: it just
				//generates a fixed declaration.
				return !hasSettingLookups;
			}

			protected getDeclarations(): string[] {
				return this.generator.getValue();
			}

			dispose(): void {
				this.cssDeclarations.dispose();
			}
		}

		class CssRuleSet {
			public readonly cssText: KnockoutComputed<string>;
			private readonly selectorText: string;

			constructor(
				selectors: string[],
				private readonly declarationSources: DeclarationSource[]
			) {
				this.selectorText = selectors.join(', ');

				this.cssText = ko.computed({
					read: () => {
						const declarations = this.getDeclarations();
						if (declarations.length === 0) {
							return '';
						}
						return this.selectorText + ' {\n\t' + declarations.join('\n\t') + '\n}';
					},
					deferEvaluation: true,
				}).extend({deferred: true});
			}

			isActive(): boolean {
				for (const source of this.declarationSources) {
					if (source.isActive()) {
						return true;
					}
				}
				return false;
			}

			protected getDeclarations(): string[] {
				const declarations = [];
				for (const source of this.declarationSources) {
					if (source.isActive()) {
						declarations.push(...source.cssDeclarations());
					}
				}
				return declarations;
			}

			dispose(): void {
				//Dispose declaration sources.
				for (const source of this.declarationSources) {
					source.dispose();
				}
				//Dispose the CSS text observable.
				this.cssText.dispose();
			}
		}

		class PreviewStyleBlock {
			private readonly cssText: KnockoutComputed<string>;
			private $styleElement: JQuery = null;
			private cssChangeSubscription: KnockoutSubscription;

			constructor(
				private readonly ruleSets: CssRuleSet[],
				private readonly condition: () => boolean = null
			) {
				this.cssText = ko.computed({
					read: () => {
						if ((condition !== null) && !condition()) {
							return '';
						}

						let pieces = [];
						for (const ruleset of this.ruleSets) {
							if (ruleset.isActive()) {
								const css = ruleset.cssText();
								if (css !== '') {
									pieces.push(css);
								}
							}
						}
						if (pieces.length === 0) {
							return '';
						}

						return pieces.join('\n');
					},
					deferEvaluation: true,
				}).extend({deferred: true});

				this.updateStyleElement(this.cssText());

				this.cssChangeSubscription = this.cssText.subscribe((cssText) => {
					this.updateStyleElement(cssText);
				});
			}

			private updateStyleElement(cssText: string): void {
				if (cssText === '') {
					if (this.$styleElement) {
						this.$styleElement.remove();
						this.$styleElement = null;
					}
					return;
				}

				if (!this.$styleElement) {
					this.$styleElement = $('<style></style>').appendTo('head');
				}
				this.$styleElement.text(cssText);
			}

			private clear(): void {
				if (this.$styleElement) {
					this.$styleElement.remove();
					this.$styleElement = null;
				}
			}

			dispose(): void {
				//Stop listening for CSS changes.
				this.cssChangeSubscription.dispose();
				this.cssText.dispose();

				//Dispose rule sets.
				for (const ruleset of this.ruleSets) {
					ruleset.dispose();
				}

				//Remove the style element.
				this.clear();
			}
		}
	}
}