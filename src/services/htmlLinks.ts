/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createScanner } from '../parser/htmlScanner';
import { TextDocument, Range, DocumentLink } from 'vscode-languageserver-types';
import * as strings from '../utils/strings';
import { URI as Uri } from 'vscode-uri';

import { TokenType, DocumentContext } from '../htmlLanguageTypes';

function normalizeRef(url: string, languageId: string): string {
	const first = url[0];
	const last = url[url.length - 1];
	if (first === last && (first === '\'' || first === '\"')) {
		url = url.substr(1, url.length - 2);
	}
	return url;
}

function validateRef(url: string, languageId: string): boolean {
	if (!url.length) {
		return false;
	}
	if (languageId === 'handlebars' && /{{.*}}/.test(url)) {
		return false;
	}
	return /\b(w[\w\d+.-]*:\/\/)?[^\s()<>]+(?:\([\w\d]+\)|([^[:punct:]\s]|\/?))/.test(url);
}

function getWorkspaceUrl(documentUri: string, tokenContent: string, documentContext: DocumentContext, base: string | undefined): string | undefined {
	if (/^\s*javascript\:/i.test(tokenContent) || /^\s*\#/i.test(tokenContent) || /[\n\r]/.test(tokenContent)) {
		return undefined;
	}
	tokenContent = tokenContent.replace(/^\s*/g, '');

	if (/^https?:\/\//i.test(tokenContent) || /^file:\/\//i.test(tokenContent)) {
		// Absolute link that needs no treatment
		return tokenContent;
	}

	if (/^\/\//i.test(tokenContent)) {
		// Absolute link (that does not name the protocol)
		const pickedScheme = strings.startsWith(documentUri, 'https://') ? 'https' : 'http';
		return pickedScheme + ':' + tokenContent.replace(/^\s*/g, '');
	}
	if (documentContext) {
		return documentContext.resolveReference(tokenContent, base || documentUri);
	}
	return tokenContent;
}

function createLink(document: TextDocument, documentContext: DocumentContext, attributeValue: string, startOffset: number, endOffset: number, base: string | undefined): DocumentLink | undefined {
	const tokenContent = normalizeRef(attributeValue, document.languageId);
	if (!validateRef(tokenContent, document.languageId)) {
		return undefined;
	}
	if (tokenContent.length < attributeValue.length) {
		startOffset++;
		endOffset--;
	}
	const workspaceUrl = getWorkspaceUrl(document.uri, tokenContent, documentContext, base);
	if (!workspaceUrl || !isValidURI(workspaceUrl)) {
		return undefined;
	}
	return {
		range: Range.create(document.positionAt(startOffset), document.positionAt(endOffset)),
		target: workspaceUrl
	};
}

function isValidURI(uri: string) {
	try {
		Uri.parse(uri);
		return true;
	} catch (e) {
		return false;
	}
}

export function findDocumentLinks(document: TextDocument, documentContext: DocumentContext): DocumentLink[] {
	const newLinks: DocumentLink[] = [];

	const rootAbsoluteUrl: Uri | null = null;

	const scanner = createScanner(document.getText(), 0);
	let token = scanner.scan();
	let afterHrefOrSrc = false;
	let afterBase = false;
	let base: string | undefined = void 0;
	while (token !== TokenType.EOS) {
		switch (token) {
			case TokenType.StartTag:
				if (!base) {
					const tagName = scanner.getTokenText().toLowerCase();
					afterBase = tagName === 'base';
				}
				break;
			case TokenType.AttributeName:
				const attributeName = scanner.getTokenText().toLowerCase();
				afterHrefOrSrc = attributeName === 'src' || attributeName === 'href';
				break;
			case TokenType.AttributeValue:
				if (afterHrefOrSrc) {
					const attributeValue = scanner.getTokenText();
					if (!afterBase) { // don't highlight the base link itself
						const link = createLink(document, documentContext, attributeValue, scanner.getTokenOffset(), scanner.getTokenEnd(), base);
						if (link) {
							newLinks.push(link);
						}
					}
					if (afterBase && typeof base === 'undefined') {
						base = normalizeRef(attributeValue, document.languageId);
						if (base && documentContext) {
							base = documentContext.resolveReference(base, document.uri);
						}
					}
					afterBase = false;
					afterHrefOrSrc = false;
				}
				break;
		}
		token = scanner.scan();
	}
	return newLinks;
}