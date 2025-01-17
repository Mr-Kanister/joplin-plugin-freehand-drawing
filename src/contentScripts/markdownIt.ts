import type MarkdownIt = require("markdown-it");
import type Renderer = require("markdown-it/lib/renderer");
import type Token = require("markdown-it/lib/token");
import localization from "../localization";

declare const webviewApi: any;

// We need to pass [editSvgCommandIdentifier] as an argument because we're converting
// editImage to a string.
const editImage = (contentScriptId: string, container: HTMLElement, svgId: string) => {
	const imageElem = container.querySelector('img') ?? document.querySelector(`img#${svgId}`);

	if (!imageElem?.src) {
		throw new Error(`${imageElem} lacks an src attribute. Unable to edit!`);
	}

	const updateCachebreaker = (initialSrc: string) => {
		// Strip the ?t=... at the end of the image URL
		const cachebreakerMatch = /^(.*)\?t=(\d+)$/.exec(initialSrc);
		const fileUrl = cachebreakerMatch ? cachebreakerMatch[1] : initialSrc;

		const oldCachebreaker = cachebreakerMatch ? parseInt(cachebreakerMatch[2]) : 0;
		const newCachebreaker = (new Date()).getTime();

		// Add the cachebreaker to the global list -- we may need to change cachebreakers
		// on future rerenders.
		window['outOfDateCacheBreakers'] ??= {};
		window['outOfDateCacheBreakers'][fileUrl] = {
			outdated: oldCachebreaker,
			suggested: newCachebreaker,
		};

		return `${fileUrl}?t=${newCachebreaker}`;
	};

	// The webview api is different if we're running in the TinyMce editor vs if we're running
	// in the preview pane.
	const message = imageElem.src;
	const imageElemClass = `imageelem-${(new Date()).getTime()}`;
	imageElem.classList.add(imageElemClass);

	try {
		const postMessage = webviewApi.postMessage;
		postMessage(contentScriptId, message).then(resourceId => {
			// Update all matching
			const toRefresh = document.querySelectorAll(`img[data-resource-id="${resourceId}"]`);
			for (const elem of toRefresh) {
				const imageElem = elem as HTMLImageElement;
				imageElem.src = updateCachebreaker(imageElem.src);
			}
		}).catch(err => {
			console.error('Error posting message!', err, '\nMessage: ', message);
		});
	} catch (err) {
		console.warn('Error posting message', err);
		console.log('Retrying...');
	}
};

const onImgLoad = (container: HTMLElement, buttonId: string) => {
	let button = container.querySelector('button.jsdraw--editButton');
	const imageElem = container.querySelector('img');

	// Another plugin may have moved the button
	if (!button) {
		button = document.querySelector(`#${buttonId}`);
		button.remove();
		container.appendChild(button);	
	}
	container.classList.add('jsdraw--svgWrapper');

	const outOfDateCacheBreakers = window['outOfDateCacheBreakers'] ?? {};
	const imageSrcMatch = /^(.*)\?t=(\d+)$/.exec(imageElem.src);
	
	if (!imageSrcMatch) {
		throw new Error(`${imageElem?.src} doesn't have a cachebreaker! Unable to update it.`);
	}

	const fileUrl = imageSrcMatch[1];
	const cachebreaker = parseInt(imageSrcMatch[2] ?? '0');
	const badCachebreaker = outOfDateCacheBreakers[fileUrl] ?? {};

	if (isNaN(cachebreaker) || cachebreaker <= badCachebreaker?.outdated) {
		imageElem.src = `${fileUrl}?t=${badCachebreaker.suggested}`;
	}


	let haveWebviewApi = true;
	try {
		// Attempt to access .postMessage
		// Note: We can't just check window.webviewApi because webviewApi seems not to be
		//       a property on window.
		haveWebviewApi = typeof webviewApi.postMessage === 'function';
	} catch (e) {
		console.error(e);
		haveWebviewApi = false;
	}

	if (!haveWebviewApi) {
		console.log(
			'The webview library either doesn\'t exist or lacks a postMessage function. Unable to display an edit button.'
		);
		button?.remove();
	}
};

export default (context: { contentScriptId: string }) => {
	return {
		plugin: (markdownIt: MarkdownIt, _options) => {
			const editSvgCommandIdentifier = context.contentScriptId;
			let idCounter = 0;

			const editImageFnString = editImage.toString().replace(/["]/g, '&quot;');
			const onImgLoadFnString = onImgLoad.toString().replace(/["]/g, '&quot;');

			// Ref: https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md#renderer
			// and the joplin-drawio plugin
			const originalRenderer = markdownIt.renderer.rules.image;
			markdownIt.renderer.rules.image = (
				tokens: Token[], idx: number, options: MarkdownIt.Options, env: any, self: Renderer
			): string => {
				const defaultHtml = originalRenderer(tokens, idx, options, env, self);

				const svgUrlExp = /.*['"](file:[/][/])?[^'"]*[.]svg([?].*)?['"]/i;
				if (!svgUrlExp.exec(defaultHtml ?? '')) {
					return defaultHtml;
				}

				const buttonId = `io-github-personalizedrefrigerator-js-draw-edit-button-${idCounter}`;
				const svgId = `io-github-personalizedrefrigerator-js-draw-editable-svg-${idCounter}`;
				idCounter++;

				const htmlWithOnload = defaultHtml.replace('<img ', `<img id="${svgId}" onload="(${onImgLoadFnString})(this.parentElement, '${buttonId}')" `);

				return `
				<span class='jsdraw--svgWrapper' contentEditable='false'>
					${htmlWithOnload}
					<button
						class='jsdraw--editButton'
						onclick="(${editImageFnString})('${editSvgCommandIdentifier}', this.parentElement, '${svgId}')"
						id="${buttonId}"
					>
						${localization.edit} 🖊️
					</button>
				</span>
				`;
			};
		},
		assets: () => {
			return [
				{ name: 'markdownIt.css' }
			]
		},
	}
}