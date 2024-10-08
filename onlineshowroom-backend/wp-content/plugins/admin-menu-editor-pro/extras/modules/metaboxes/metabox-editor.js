/// <reference path="../../../js/lodash-3.10.d.ts" />
/// <reference path="../../../js/knockout.d.ts" />
/// <reference path="../../../modules/actor-selector/actor-selector.ts" />
/// <reference path="../../../js/common.d.ts" />
class AmeMetaBoxEditor {
    constructor(settings, forceRefreshUrl) {
        this.canAnyBoxesBeDeleted = false;
        this.actorSelector = new AmeActorSelector(AmeActors, true);
        //Wrap the selected actor in a computed observable so that it can be used with Knockout.
        let _selectedActor = ko.observable(this.actorSelector.selectedActor
            ? AmeActors.getActor(this.actorSelector.selectedActor)
            : null);
        this.selectedActor = ko.computed({
            read: function () {
                return _selectedActor();
            },
            write: (newActor) => {
                this.actorSelector.setSelectedActor(newActor ? newActor.id : null);
            }
        });
        this.actorSelector.onChange((newSelectedActorId) => {
            if (newSelectedActorId === null) {
                _selectedActor(null);
            }
            else {
                _selectedActor(AmeActors.getActor(newSelectedActorId));
            }
        });
        this.screens = ko.observableArray(AmeMetaBoxEditor._.map(settings.screens, (screenData, id) => {
            let metaBoxes = screenData['metaBoxes:'];
            if (AmeMetaBoxEditor._.isEmpty(metaBoxes)) {
                metaBoxes = {};
            }
            if (screenData['postTypeFeatures:'] && !AmeMetaBoxEditor._.isEmpty(screenData['postTypeFeatures:'])) {
                const features = screenData['postTypeFeatures:'];
                for (let featureName in features) {
                    if (features.hasOwnProperty(featureName)) {
                        metaBoxes['cpt-feature:' + featureName] = features[featureName];
                    }
                }
            }
            return new AmeMetaBoxCollection(id, metaBoxes, screenData['isContentTypeMissing:'], this);
        }));
        this.screens.sort(function (a, b) {
            return a.formattedTitle.localeCompare(b.formattedTitle);
        });
        this.canAnyBoxesBeDeleted = AmeMetaBoxEditor._.some(this.screens(), 'canAnyBeDeleted');
        this.settingsData = ko.observable('');
        this.forceRefreshUrl = forceRefreshUrl;
        this.isSlugWarningEnabled = ko.observable(true);
    }
    //noinspection JSUnusedGlobalSymbols It's actually used in the KO template, but PhpStorm doesn't realise that.
    saveChanges() {
        let settings = this.getCurrentSettings();
        //Set the hidden form fields.
        this.settingsData(JSON.stringify(settings));
        //Submit the form.
        return true;
    }
    getCurrentSettings() {
        const collectionFormatName = 'Admin Menu Editor meta boxes', collectionFormatVersion = '1.0';
        let settings = {
            format: {
                name: collectionFormatName,
                version: collectionFormatVersion
            },
            screens: {},
            isInitialRefreshDone: true
        };
        const _ = AmeMetaBoxEditor._;
        _.forEach(this.screens(), function (collection) {
            let thisScreenData = {
                'metaBoxes:': {},
                'postTypeFeatures:': {},
                'isContentTypeMissing:': collection.isContentTypeMissing
            };
            _.forEach(collection.boxes(), function (metaBox) {
                let key = metaBox.parentCollectionKey ? metaBox.parentCollectionKey : 'metaBoxes:';
                thisScreenData[key][metaBox.id] = metaBox.toPropertyMap();
            });
            settings.screens[collection.screenId] = thisScreenData;
        });
        return settings;
    }
    //noinspection JSUnusedGlobalSymbols It's used in the KO template.
    promptForRefresh() {
        if (confirm('Refresh the list of available meta boxes?\n\nWarning: Unsaved changes will be lost.')) {
            window.location.href = this.forceRefreshUrl;
        }
    }
    deleteScreen(screen) {
        if (!screen.isContentTypeMissing) {
            alert('That screen may still exist; it cannot be deleted.');
            return;
        }
        this.screens.remove(screen);
    }
}
AmeMetaBoxEditor._ = wsAmeLodash;
class AmeMetaBox {
    constructor(settings, metaBoxEditor) {
        this.isHiddenByDefault = false;
        this.canBeDeleted = false;
        this.isVirtual = false;
        this.tooltipText = null;
        AmeMetaBox.counter++;
        this.uniqueHtmlId = 'ame-mb-item-' + AmeMetaBox.counter;
        const _ = AmeMetaBox._;
        this.metaBoxEditor = metaBoxEditor;
        this.initialProperties = settings;
        if (settings['parentCollectionKey']) {
            this.parentCollectionKey = settings['parentCollectionKey'];
        }
        this.id = settings['id'];
        this.title = _.get(settings, 'title', '[Untitled widget]');
        this.context = _.get(settings, 'context', 'normal');
        this.isHiddenByDefault = _.get(settings, 'isHiddenByDefault', false);
        this.grantAccess = new AmeActorAccessDictionary(_.get(settings, 'grantAccess', {}));
        this.defaultVisibility = new AmeActorAccessDictionary(_.get(settings, 'defaultVisibility', {}));
        this.canBeDeleted = !_.get(settings, 'isPresent', true);
        this.isVirtual = _.get(settings, 'isVirtual', false);
        if (this.isVirtual) {
            this.tooltipText = 'Technically, this is not a meta box, but it\'s included here for convenience.';
        }
        this.isAvailable = ko.computed({
            read: () => {
                const actor = metaBoxEditor.selectedActor();
                if (actor !== null) {
                    return AmeMetaBox.actorHasAccess(actor, this.grantAccess, true, true);
                }
                else {
                    //Check if any actors have this widget enabled.
                    //We only care about visible actors. There might be some users that are loaded but not visible.
                    const actors = metaBoxEditor.actorSelector.getVisibleActors();
                    return _.some(actors, (anActor) => {
                        return AmeMetaBox.actorHasAccess(anActor, this.grantAccess, true, true);
                    });
                }
            },
            write: (checked) => {
                if ((this.id === 'slugdiv') && !checked && this.metaBoxEditor.isSlugWarningEnabled()) {
                    const warningMessage = 'Hiding the "Slug" metabox can prevent the user from changing the post slug.\n'
                        + 'This is caused by a known bug in WordPress core.\n'
                        + 'Do you want to hide this metabox anyway?';
                    if (confirm(warningMessage)) {
                        //Suppress the warning.
                        this.metaBoxEditor.isSlugWarningEnabled(false);
                    }
                    else {
                        this.isAvailable.notifySubscribers();
                        return;
                    }
                }
                const actor = metaBoxEditor.selectedActor();
                if (actor !== null) {
                    this.grantAccess.set(actor.getId(), checked);
                }
                else {
                    //Enable/disable all.
                    _.forEach(metaBoxEditor.actorSelector.getVisibleActors(), (anActor) => { this.grantAccess.set(anActor.getId(), checked); });
                }
            }
        });
        this.isVisibleByDefault = ko.computed({
            read: () => {
                const actor = metaBoxEditor.selectedActor();
                if (actor !== null) {
                    return AmeMetaBox.actorHasAccess(actor, this.defaultVisibility, !this.isHiddenByDefault, null);
                }
                else {
                    const actors = metaBoxEditor.actorSelector.getVisibleActors();
                    return _.some(actors, (anActor) => {
                        return AmeMetaBox.actorHasAccess(anActor, this.defaultVisibility, !this.isHiddenByDefault, null);
                    });
                }
            },
            write: (checked) => {
                const actor = metaBoxEditor.selectedActor();
                if (actor !== null) {
                    this.defaultVisibility.set(actor.getId(), checked);
                }
                else {
                    //Enable/disable all.
                    _.forEach(metaBoxEditor.actorSelector.getVisibleActors(), (anActor) => { this.defaultVisibility.set(anActor.getId(), checked); });
                }
            }
        });
        this.canChangeDefaultVisibility = ko.computed(() => {
            return this.isAvailable() && !this.isVirtual;
        });
        this.safeTitle = ko.computed(() => {
            return AmeMetaBox.stripAllTags(this.title);
        });
    }
    static actorHasAccess(actor, grants, roleDefault = true, superAdminDefault = true) {
        //Is there a setting for this actor specifically?
        let hasAccess = grants.get(actor.getId(), null);
        if (hasAccess !== null) {
            return hasAccess;
        }
        if (actor instanceof AmeUser) {
            //The Super Admin has access to everything by default, and it takes priority over roles.
            if (actor.isSuperAdmin) {
                const adminHasAccess = grants.get('special:super_admin', null);
                if (adminHasAccess !== null) {
                    return adminHasAccess;
                }
                else if (superAdminDefault !== null) {
                    return superAdminDefault;
                }
            }
            //Allow access if at least one role has access.
            let result = false;
            for (let index = 0; index < actor.roles.length; index++) {
                let roleActor = 'role:' + actor.roles[index], roleHasAccess = grants.get(roleActor, roleDefault);
                result = result || roleHasAccess;
            }
            return result;
        }
        return roleDefault;
    }
    toPropertyMap() {
        let properties = {
            'id': this.id,
            'title': this.title,
            'context': this.context,
            'grantAccess': this.grantAccess.getAll(),
            'defaultVisibility': this.defaultVisibility.getAll(),
            'isHiddenByDefault': this.isHiddenByDefault
        };
        //Preserve unused properties on round-trip.
        properties = AmeMetaBox._.merge({}, this.initialProperties, properties);
        return properties;
    }
    static stripAllTags(input) {
        //Based on: http://phpjs.org/functions/strip_tags/
        const tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
        return input.replace(commentsAndPhpTags, '').replace(tags, '');
    }
}
AmeMetaBox._ = wsAmeLodash;
AmeMetaBox.counter = 0;
class AmeMetaBoxCollection {
    constructor(screenId, metaBoxes, isContentTypeMissing, metaBoxEditor) {
        this.canAnyBeDeleted = false;
        this.isContentTypeMissing = false;
        this.screenId = screenId;
        this.formattedTitle = screenId.charAt(0).toUpperCase() + screenId.slice(1);
        this.isContentTypeMissing = isContentTypeMissing;
        this.boxes = ko.observableArray(AmeMetaBoxCollection._.map(metaBoxes, function (properties) {
            return new AmeMetaBox(properties, metaBoxEditor);
        }));
        this.boxes.sort(function (a, b) {
            return a.id.localeCompare(b.id);
        });
        this.canAnyBeDeleted = AmeMetaBoxCollection._.some(this.boxes(), 'canBeDeleted');
    }
    //noinspection JSUnusedGlobalSymbols Use by KO.
    deleteBox(item) {
        this.boxes.remove(item);
    }
}
AmeMetaBoxCollection._ = wsAmeLodash;
jQuery(function () {
    let metaBoxEditor = new AmeMetaBoxEditor(wsAmeMetaBoxEditorData.settings, wsAmeMetaBoxEditorData.refreshUrl);
    ko.applyBindings(metaBoxEditor, document.getElementById('ame-meta-box-editor'));
    //Make the column widths the same in all tables.
    const $ = jQuery;
    let tables = $('.ame-meta-box-list'), columnCount = tables.find('thead').first().find('th').length, maxWidths = wsAmeLodash.fill(Array(columnCount), 0);
    tables.find('tr').each(function () {
        $(this).find('td,th').each(function (index) {
            const width = $(this).width();
            if (maxWidths[index]) {
                maxWidths[index] = Math.max(width, maxWidths[index]);
            }
            else {
                maxWidths[index] = width;
            }
        });
    });
    tables.each(function () {
        $(this).find('thead th').each(function (index) {
            $(this).width(maxWidths[index]);
        });
    });
    //Set up tooltips.
    if ($['qtip']) {
        $('#ame-meta-box-editor .ws_tooltip_trigger').qtip({
            style: {
                classes: 'qtip qtip-rounded ws_tooltip_node'
            }
        });
    }
});
//# sourceMappingURL=metabox-editor.js.map