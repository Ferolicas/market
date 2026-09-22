class_name MarketGameShell
extends Control
signal sign_out_requested
const Widgets = preload("res://game/ui/widgets.gd")
const Game = preload("res://game/engine.gd")
const Progression = preload("res://game/core/engine_progression.gd")
var store: MarketStore
var world: MarketWorld
var player_name := ""
var hud: MarketHud
var overlay: Control
var panel := ""
var panel_content: VBoxContainer
var panel_revision := -1
var setup_avatar: Dictionary = {}
var setup_country := "ES"
var panel_scroll: ScrollContainer
var close_day_button: Button
var panel_reflow := Callable()
var panel_key := ""
var panel_refresh_pending := false
var avatar_gallery: MarketAvatarGallery
var avatar_choices := []
var avatar_preview: MarketAvatarPreview
var celebration: MarketMissionComplete
var previous_purchased: Variant = null

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = Widgets.theme()
	var joystick_view := MarketJoystickOverlay.new()
	joystick_view.world = world
	add_child(joystick_view)
	celebration = MarketMissionComplete.new()
	add_child(celebration)
	hud = MarketHud.new()
	add_child(hud)
	hud.panel_requested.connect(open_panel)
	hud.toggle_requested.connect(func(): store.dispatch({"type": "TOGGLE_STORE"}))
	hud.save_requested.connect(store.save_game)
	store.changed.connect(refresh)
	world.transfers.landed.connect(refresh)
	store.message_changed.connect(func(message: String, _revision: int): hud.toast.text = message)
	world.orders_requested.connect(func():
		if panel.is_empty(): open_panel("orders"))
	refresh()

func refresh() -> void:
	if store.game == null: return
	var game: Dictionary = store.game
	var franchise := Progression.current_franchise(game)
	if is_instance_valid(close_day_button): close_day_button.disabled = not franchise.open or BusinessDay.business_day_is_closing(game.minuteOfDay)
	var purchased: Array = JS.get_or(franchise, "purchases", {}).get("purchased", []).duplicate()
	var current := {"franchiseId": franchise.id, "purchased": purchased}
	if previous_purchased == null or previous_purchased.franchiseId != franchise.id: celebration.visible = false
	var added: Variant = PurchaseCelebration.newly_completed_purchase(previous_purchased, current)
	previous_purchased = current
	if added != null:
		for definition in MartCampaign.OPENING_PURCHASES:
			if definition.id == added:
				celebration.show_purchase(definition.label)
				FeedbackBus.shared().emit("mission")
				break
	hud.update(game, world.visual_franchise(franchise), store, player_name)
	world.driveable = panel.is_empty() and game.tutorialStep > 0
	if game.tutorialStep == 0 and panel != "setup": open_panel("setup")
	if panel == "setup" and game.tutorialStep > 0: close_panel()
	if panel in ["stock", "orders", "team", "map", "finance"]:
		var key := _panel_state_key()
		if key != panel_key and not panel_refresh_pending:
			panel_refresh_pending = true
			_refresh_panel.call_deferred()
	if store.save_status == "conflict" and panel != "conflict": open_panel("conflict")

func close_panel() -> void:
	avatar_preview = null
	close_day_button = null
	panel_reflow = Callable()
	if overlay != null:
		remove_child(overlay)
		overlay.queue_free()
		overlay = null
	panel = ""
	hud.set_active_panel("")
	world.driveable = store.game != null and store.game.tutorialStep > 0

func open_panel(id: String) -> void:
	close_panel()
	panel = id
	hud.set_active_panel(id)
	if id == "setup":
		setup_avatar = store.game.avatar.duplicate(true)
		setup_country = store.game.countryCode
	world.driveable = false
	overlay = ColorRect.new()
	(overlay as ColorRect).color = Color(0.05, 0.1, 0.08, 0.45)
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(overlay)
	var card := PanelContainer.new()
	card.name = "ManagementPanel"
	overlay.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	card.add_child(column)
	var header := HBoxContainer.new()
	column.add_child(header)
	var heading := VBoxContainer.new()
	heading.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(heading)
	Widgets.label(heading, "MINI MARKET OS", 11)
	var title := Widgets.copy(heading, {"stock": "Inventario y estanterías", "orders": "Pedidos", "team": "Equipo y mejoras", "map": "Mapa de franquicias", "finance": "Dirección financiera", "avatar": "Vestuario del fundador", "help": "Cómo jugar", "settings": "Sonido y vibración", "setup": "Crea tu empresa", "conflict": "Progreso distinto en otro dispositivo"}[panel], 25)
	if panel != "setup":
		var close := Widgets.button(header, "×", close_panel)
		close.name = "ClosePanel"
		close.tooltip_text = "Cerrar"
		close.custom_minimum_size.x = 48
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	panel_scroll = scroll
	column.add_child(scroll)
	panel_content = VBoxContainer.new()
	panel_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_content.add_theme_constant_override("separation", 12)
	scroll.add_child(panel_content)
	var company: Label
	if panel not in ["setup", "conflict"]:
		var footer := HBoxContainer.new()
		footer.name = "PanelFooter"
		column.add_child(footer)
		company = Widgets.label(footer, "Empresa: %s · %s" % [Catalog.COUNTRIES[store.game.countryCode].name, store.game.currency], 11)
		company.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		close_day_button = Widgets.button(footer, "Cerrar tienda y jornada", _action.bind({"type": "CLOSE_DAY"}))
		close_day_button.add_theme_font_size_override("font_size", 11)
		var logout := Widgets.button(footer, "Cerrar sesión", func(): sign_out_requested.emit())
		logout.add_theme_font_size_override("font_size", 11)
		var franchise := Progression.current_franchise(store.game)
		close_day_button.disabled = not franchise.open or BusinessDay.business_day_is_closing(store.game.minuteOfDay)
	var reflow := func():
		var safe := MarketSafeArea.insets(get_viewport())
		var phone := size.x <= 820
		title.add_theme_font_size_override("font_size", 19 if phone else 25)
		# The nav bar is now a full-width dock flush to the footer, drawn
		# above this overlay (see MarketHud._nav_bar()'s z_index); stopping
		# short of its top edge, instead of just the raw safe-area inset, is
		# what makes the panel read as living inside the menu instead of a
		# separate modal that buries it.
		var footer_clear: float = size.y - hud.menu.position.y
		var available := size - Vector2(safe.x + safe.z, safe.y + footer_clear)
		if is_instance_valid(company): company.visible = not phone
		card.size = Vector2(minf(1040, available.x * (1.0 if phone else 0.95)), minf(760, available.y * (0.95 if panel == "setup" else (0.93 if phone else 0.91))))
		card.position = Vector2(safe.x + (available.x - card.size.x) / 2, size.y - footer_clear - card.size.y)
	reflow.call()
	resized.connect(reflow)
	card.tree_exiting.connect(func():
		if resized.is_connected(reflow): resized.disconnect(reflow))
	overlay.gui_input.connect(func(event: InputEvent):
		if panel not in ["setup", "conflict"] and event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and not card.get_global_rect().has_point(event.global_position): close_panel())
	_fill_panel()
	# Visibility/font changes invalidate minimum sizes on the next layout pass.
	panel_reflow = reflow
	_reflow_panel.call_deferred()

func _reflow_panel() -> void:
	if panel_reflow.is_valid(): panel_reflow.call()

func _fill_panel() -> void:
	_render_panel()
	for child in panel_content.get_children():
		if child is Label: child.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel_key = _panel_state_key()

func _action(action: Dictionary) -> void:
	var result: Variant = store.dispatch(action)
	if result != null and result.ok:
		if action.type == "UPGRADE_ROSTER": FeedbackBus.shared().emit("upgrade")
		if action.type == "TRAVEL": close_panel()

func _render_panel() -> void:
	var game: Dictionary = store.game
	var franchise := Progression.current_franchise(game)
	match panel:
		"setup":
			Widgets.label(panel_content, "BIENVENIDO, FUNDADOR")
			var explanation := Widgets.label(panel_content, ("El país determina la moneda y la escala de precios. Sin impuestos ni cargos diarios en la campaña." if Game.is_campaign_game(game) else "El país determina la moneda, la fiscalidad y los costes.") + " Después no podrá cambiarse en esta partida.")
			explanation.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			var countries := Widgets.grid(panel_content, 2, 2, 2)
			var country_group := ButtonGroup.new()
			for code in Catalog.COUNTRIES:
				var country: Dictionary = Catalog.COUNTRIES[code]
				var description: String = country.currency + ("" if Game.is_campaign_game(game) else " · renta %s%%" % JS.to_fixed(country.corporateTaxRate * 100, 1))
				var button := Widgets.button(countries, country.name + "\n" + description, func(): setup_country = code)
				button.name = "Country" + code
				button.toggle_mode = true
				button.button_group = country_group
				button.button_pressed = code == setup_country
				button.icon = Widgets.emoji_texture(Widgets.country_flag(code))
				button.add_theme_constant_override("icon_max_width", 24)
				button.expand_icon = true
				button.clip_text = true
				button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				button.add_theme_font_size_override("font_size", 13)
			_avatar_options()
			Widgets.button(panel_content, "Abrir mi primer Mini Market", func():
				var avatar_action := setup_avatar.duplicate(true)
				avatar_action.type = "SET_AVATAR"
				store.dispatch(avatar_action)
				store.dispatch({"type": "SET_COUNTRY", "countryCode": setup_country})
				store.save_game())
		"stock": _stock_cards(franchise)
		"orders":
			Widgets.label(panel_content, "Encargos de clientes", 20)
			var contracts := CampaignContracts.campaign_contracts(franchise)
			for contract in contracts:
				Widgets.label(panel_content, contract.label)
				Widgets.label(panel_content, " + ".join(contract.products.map(func(product): return "1 " + Catalog.PRODUCTS[product].name)))
				if contract.completed: Widgets.label(panel_content, "Entregado")
				else: Widgets.button(panel_content, "Completa el anterior" if not contract.previousDone else ("Desbloquea sus productos" if not contract.unlocked else ("Entregar cesta" if contract.ready else "Reúne los 3 en tu cesta")), _action.bind({"type": "DELIVER_CONTRACT", "contractId": contract.id}), not contract.ready)
			if contracts.is_empty(): Widgets.label(panel_content, "Todavía no hay encargos en este local.")
			Widgets.label(panel_content, "Tu trabajo personal", 20)
			var tasks := Game.campaign_personal_tasks(game) if franchise.get("purchases") != null else Objectives.level_objective_tasks(game.level, game)
			for task in tasks:
				Widgets.label(panel_content, task.label)
				Widgets.label(panel_content, "%d / %d · %s" % [floori(minf(task.progress, task.target)), task.target, "✓" if task.progress >= task.target else "%d %%" % JS.round(minf(100, task.progress / maxf(task.target, 1) * 100))])
			Widgets.label(panel_content, "Retirar del almacén", 20)
			var available: int = maxi(0, franchise.carry.capacity - CarrySystem.carry_total(franchise.carry))
			Widgets.label(panel_content, "Espacio libre en tu cesta: %d de %d." % [available, franchise.carry.capacity])
			for id in Catalog.PRODUCTS:
				if franchise.warehouse[id] > 0: Widgets.button(panel_content, "%s · %d en almacén" % [Catalog.PRODUCTS[id].name, franchise.warehouse[id]], _action.bind({"type": "PICKUP_WAREHOUSE", "productId": id, "quantity": mini(available, franchise.warehouse[id])}), available <= 0)
			if not franchise.warehouse.values().any(func(quantity): return quantity > 0): Widgets.label(panel_content, "El almacén está vacío.")
			Widgets.label(panel_content, "Pedidos a proveedores", 20)
			for order in game.pendingOrders: Widgets.label(panel_content, "%d × %s · En camino" % [order.quantity, Catalog.PRODUCTS[order.productId].name])
			for supplier in Catalog.SUPPLIERS:
				Widgets.label(panel_content, "%s · %d min · descuento %d%%" % [supplier.name, supplier.leadMinutes, roundi(supplier.discount * 100)])
				if not Catalog.PRODUCTS.keys().any(func(id): return Catalog.PRODUCTS[id].supplier == supplier.id and Game.can_order_product(game, id)):
					Widgets.label(panel_content, "Desbloquea su cadena" if franchise.get("purchases") != null else "Nivel %d" % supplier.unlockLevel)
				for id in Catalog.PRODUCTS:
					var product: Dictionary = Catalog.PRODUCTS[id]
					if product.supplier == supplier.id: Widgets.button(panel_content, "%s · 10 × %s" % [product.name, Game.format_money(product.wholesaleMinor * Game.country_money_scale(game.countryCode) * (1 - supplier.discount), game)], _action.bind({"type": "ORDER", "supplierId": supplier.id, "productId": id, "quantity": 10}), not Game.can_order_product(game, id))
		"team": _team_cards(game, franchise)
		"map":
			var grid := Widgets.grid(panel_content, 3, 2, 2)
			for item in game.franchises:
				var card := Widgets.card(grid)
				Widgets.emoji(card, "🏙️" if item == game.franchises.back() else "🏪", 48)
				Widgets.copy(card, item.name, 20)
				Widgets.copy(card, "LOCAL %d" % (game.franchises.find(item) + 1) if Game.is_campaign_game(game) else "NIVEL %d" % item.unlockLevel)
				var quote := CampaignExpansion.campaign_expansion_quote(game, item.id)
				Widgets.copy(card, item.city)
				if item.owned: Widgets.copy(card, "%d empleados · ★ %.1f" % [item.employees.size(), item.rating])
				if Game.is_campaign_game(game):
					Widgets.copy(card, CampaignLocations.campaign_location(item.id).specialty)
					if not item.owned:
						Widgets.copy(card, quote.reason)
						if quote.get("previousName"):
							Widgets.copy(card, "Encargos del local anterior: %d/%d" % [quote.contracts.filter(func(contract): return contract.completed).size(), quote.contracts.size()])
							Widgets.copy(card, "%d/%d tareas personales · %d compras pendientes" % [quote.tasks.filter(func(task): return task.completed).size(), quote.tasks.size(), quote.missingPurchases.size()])
						if quote.missingPurchases.is_empty():
							for task in quote.tasks:
								if not task.completed:
									Widgets.copy(card, "%s: %s/%s" % [task.label, task.progress, task.target])
									break
				if item.owned: Widgets.button(card, "Estás aquí" if item.id == game.currentFranchiseId else "Viajar", _action.bind({"type": "TRAVEL", "franchiseId": item.id}), item.id == game.currentFranchiseId)
				else:
					Widgets.copy(card, Game.format_money(item.purchaseCostMinor, game), 14)
					Widgets.button(card, "Abrir local", _action.bind({"type": "BUY_FRANCHISE", "franchiseId": item.id}), game.balanceMinor < item.purchaseCostMinor or (not quote.available if Game.is_campaign_game(game) else game.level < item.unlockLevel))
		"finance":
			var grid := Widgets.grid(panel_content, 2, 1, 1)
			var summary := Widgets.card(grid)
			Widgets.copy(summary, "RESULTADO ACUMULADO")
			var profit := Widgets.copy(summary, Game.format_money(game.finances.netProfitMinor, game), 26)
			profit.add_theme_color_override("font_color", Color("2f7a4f" if game.finances.netProfitMinor >= 0 else "b24638"))
			Widgets.copy(summary, "Caja disponible: " + Game.format_money(game.balanceMinor, game))
			var ledger := Widgets.card(grid)
			for row in [["Ingresos netos de ventas", "grossRevenueMinor", 1], ["Coste de mercancía", "costOfGoodsMinor", -1], ["Nóminas y cargas", "payrollMinor", -1], ["Alquiler, energía y operación", "operatingCostsMinor", -1], ["Impuesto sobre beneficio provisionado", "taxesMinor", -1]]:
				var line := HBoxContainer.new()
				ledger.add_child(line)
				Widgets.copy(line, row[0], 13)
				Widgets.label(line, Game.format_money(game.finances[row[1]] * row[2], game), 14)
			var tax := Widgets.card(panel_content)
			Widgets.emoji(tax, Widgets.country_flag(game.countryCode), 40)
			var country: Dictionary = Catalog.COUNTRIES[game.countryCode]
			Widgets.copy(tax, "Economía de campaña" if Game.is_campaign_game(game) else "Régimen simulado: " + country.name)
			Widgets.copy(tax, "Precios finales, personal de pago único y licencia permanente. Sin bonos ni cargos diarios. La mercancía, las compras y las mejoras sí cuestan dinero." if Game.is_campaign_game(game) else "Renta corporativa %.1f%% · impuesto de ventas %.1f%% · carga laboral aproximada %.1f%%." % [country.corporateTaxRate * 100, country.salesTaxRate * 100, country.payrollBurdenRate * 100])
			Widgets.copy(tax, "Modelo educativo simplificado. No constituye asesoría fiscal ni reproduce todas las reglas, deducciones o tributos locales.")
		"settings": _sound_cards()
		"avatar": _avatar_options()
		"help":
			for item in [["ARRASTRA · WASD — Moverse", "Arrastra desde cualquier punto libre con ratón, dedo o lápiz. El teclado sigue disponible."], ["Cosecha magnética", "Cruza un bancal maduro sin detenerte. Cada verdura vuela a la cesta y la parcela vuelve a crecer automáticamente."], ["El elemento es el imán", "Acércate a cualquier lado de la máquina, el corral o el expositor: no hay casillas exactas ni avisos que pulsar."], ["Círculos dorados", "Cada compra se paga en el sitio donde va a estar. Entra en su círculo con dinero recogido de la caja."], ["Pedidos", "Encargos, trabajo personal, retirada del almacén y compras a proveedores viven en el panel de Pedidos."]]:
				Widgets.label(panel_content, item[0], 20)
				Widgets.label(panel_content, item[1])
			Widgets.label(panel_content, "1. Cosecha → 2. Surte → 3. Abre → 4. Atiende → 5. Crece")
		"conflict":
			Widgets.label(panel_content, "Conservé esta copia sin sobrescribirla.")
			Widgets.button(panel_content, "Conservar mi copia local", func():
				await store.adopt_local_copy()
				close_panel())
			Widgets.button(panel_content, "Recuperar copia del servidor", func():
				await store.restore_server_copy()
				close_panel())
func _stock_cards(franchise: Dictionary) -> void:
	var grid := Widgets.grid(panel_content, 4, 3, 2)
	for id in Catalog.PRODUCTS:
		var card := Widgets.card(grid)
		Widgets.emoji(card, Catalog.PRODUCTS[id].emoji)
		Widgets.copy(card, Catalog.PRODUCTS[id].name, 14, true)
		var counts := HBoxContainer.new()
		card.add_child(counts)
		for entry in [["ALMACÉN", franchise.warehouse[id]], ["TIENDA", franchise.shelves[id]]]:
			var count := VBoxContainer.new()
			count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			counts.add_child(count)
			Widgets.copy(count, entry[0], 10, true)
			Widgets.copy(count, str(entry[1]), 18, true)

func _team_cards(game: Dictionary, franchise: Dictionary) -> void:
	var grid := Widgets.grid(panel_content, 3, 2, 1)
	avatar_gallery = MarketAvatarGallery.new()
	panel_content.add_child(avatar_gallery)
	var employee_ordinal := 0
	for entry in RosterUpgrades.roster_entries(franchise, Game.country_money_scale(game.countryCode)):
		var card := Widgets.card(grid)
		if entry.kind in ["player", "employee"]:
			var avatar: Dictionary = game.avatar.duplicate(true)
			if entry.kind == "employee":
				avatar.body = ["adult-woman", "adult-man", "adult-woman", "adult-man"][employee_ordinal % 4]
				avatar.hair = ["ponytail", "fade", "bun", "waves"][employee_ordinal % 4]
				avatar.hat = "none"
				employee_ordinal += 1
			var portrait := TextureRect.new()
			portrait.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			portrait.custom_minimum_size = Vector2(86, 86)
			portrait.material = MarketViewportComposite.create()
			card.add_child(portrait)
			avatar_gallery.request("roster:" + entry.id + JSON.stringify(avatar), avatar, "head", func(texture: Texture2D):
				if is_instance_valid(portrait): portrait.texture = texture)
		else: Widgets.emoji(card, entry.icon, 86)
		Widgets.copy(card, entry.label, 14, true)
		Widgets.copy(card, entry.detail, 12, true)
		Widgets.copy(card, "Velocidad ×%.2f · capacidad ×%.2f" % [entry.speed, entry.capacity], 11, true)
		var upgrades := GridContainer.new()
		upgrades.columns = 4
		upgrades.add_theme_constant_override("h_separation", 6)
		card.add_child(upgrades)
		for index in entry.stepCostsMinor.size():
			var cost: int = entry.stepCostsMinor[index]
			var button := Widgets.button(upgrades, "%d\n%s" % [index + 1, "Hecho" if index < entry.step else Game.format_money(cost, game)], _action.bind({"type": "UPGRADE_ROSTER", "entryId": entry.id}), index != entry.step or game.balanceMinor < cost)
			button.tooltip_text = "Mejora %d de %s" % [index + 1, entry.label]
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.add_theme_font_size_override("font_size", 10)
			button.clip_text = true
			var style := StyleBoxFlat.new()
			style.bg_color = Color("e9edd8" if index < entry.step else ("fff4dc" if index == entry.step else "faf7ef"))
			style.border_color = Color("8fae6c" if index < entry.step else ("e0b455" if index == entry.step else "d0cbb9"))
			style.set_border_width_all(1)
			style.set_corner_radius_all(11)
			style.content_margin_left = 2
			style.content_margin_right = 2
			style.content_margin_top = 6
			style.content_margin_bottom = 6
			button.add_theme_stylebox_override("normal", style)
			button.add_theme_stylebox_override("disabled", style)

func _sound_cards() -> void:
	var settings := AudioSettingsStore.shared()
	settings.hydrate()
	var grid := Widgets.grid(panel_content, 3, 1, 1)
	var apple := DevicePlatform.is_apple_touch_device(DevicePlatform.current_device_hints())
	for key in ["music", "effects"]:
		var card := Widgets.card(grid)
		Widgets.copy(card, "Música" if key == "music" else "Efectos", 20)
		Widgets.copy(card, ("Suena en bucle mientras juegas. A cero se detiene." + (" En iPhone, si no oyes nada, sube el interruptor lateral de silencio y el volumen." if apple else "")) if key == "music" else "Pasos, estantes, máquinas, caja, mejoras y misiones.", 12)
		var volume := HBoxContainer.new()
		card.add_child(volume)
		var slider := HSlider.new()
		slider.name = "MusicVolume" if key == "music" else "EffectsVolume"
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 5
		slider.value = settings.settings()[key] * 100
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		slider.custom_minimum_size.y = 44
		volume.add_child(slider)
		var percent := Widgets.label(volume, "%d %%" % roundi(slider.value), 14)
		slider.value_changed.connect(func(value: float):
			settings.update({key: value / 100})
			percent.text = "%d %%" % roundi(value))
		if key == "effects": Widgets.button(card, "Probar caja", func(): FeedbackBus.shared().emit("payment"))
	var vibration_card := Widgets.card(grid)
	Widgets.copy(vibration_card, "Vibración", 20)
	var can_vibrate := bool(JavaScriptBridge.eval("typeof navigator.vibrate === 'function'", true)) if OS.has_feature("web") else OS.get_name() in ["Android", "iOS"]
	Widgets.copy(vibration_card, "Un toque al cobrar, al mejorar y al completar una misión." if can_vibrate else ("iPhone y iPad no permiten vibrar desde el navegador." if apple else "Este dispositivo o navegador no vibra."), 12)
	var vibration := CheckButton.new()
	vibration.text = "Activada" if settings.vibration else "Desactivada"
	vibration.disabled = not can_vibrate
	vibration.button_pressed = settings.vibration
	vibration.toggled.connect(func(value: bool):
		settings.update({"vibration": value})
		vibration.text = "Activada" if value else "Desactivada")
	vibration_card.add_child(vibration)

func _avatar_options() -> void:
	var avatar: Dictionary = setup_avatar if panel == "setup" else store.game.avatar
	var customizer := BoxContainer.new()
	customizer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	customizer.add_theme_constant_override("separation", 16)
	panel_content.add_child(customizer)
	var preview_column := VBoxContainer.new()
	preview_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	customizer.add_child(preview_column)
	var options := VBoxContainer.new()
	options.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	options.size_flags_stretch_ratio = 2.3
	options.add_theme_constant_override("separation", 10)
	customizer.add_child(options)
	avatar_preview = MarketAvatarPreview.new()
	avatar_preview.config = avatar.duplicate(true)
	preview_column.add_child(avatar_preview)
	Widgets.label(preview_column, "Arrastra para verlo en 360°", 13)
	var preview := avatar_preview
	var arrange := func():
		customizer.vertical = size.x <= 820
		preview_column.custom_minimum_size.x = 0 if customizer.vertical else 230
		preview.custom_minimum_size.y = 220 if size.x < 580 else (250 if customizer.vertical else 520)
	resized.connect(arrange)
	customizer.tree_exiting.connect(func(): if resized.is_connected(arrange): resized.disconnect(arrange))
	arrange.call()
	avatar_choices.clear()
	avatar_gallery = MarketAvatarGallery.new()
	customizer.add_child(avatar_gallery)
	for entry in [["body", Catalog.CHARACTERS, "Personaje"], ["hair", Catalog.HAIRSTYLES, "Peinado"], ["hat", [{"id": "none", "name": "Sin gorro", "emoji": "—"}] + Catalog.HATS, "Gorro de animal"]]:
		Widgets.label(options, entry[2])
		var grid := GridContainer.new()
		grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		options.add_child(grid)
		var resize_grid := func(): grid.columns = (3 if size.x < 580 else 5) if entry[0] == "hat" else (2 if size.x < 580 else 4)
		resized.connect(resize_grid)
		grid.tree_exiting.connect(func(): if resized.is_connected(resize_grid): resized.disconnect(resize_grid))
		resize_grid.call()
		for value in entry[1]:
			var button := Button.new()
			button.mouse_filter = Control.MOUSE_FILTER_PASS
			button.toggle_mode = true
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.tooltip_text = value.name
			button.custom_minimum_size.y = 126 if entry[0] == "body" else 65
			grid.add_child(button)
			var column := VBoxContainer.new()
			column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			column.offset_left = 5
			column.offset_right = -5
			column.mouse_filter = Control.MOUSE_FILTER_IGNORE
			button.add_child(column)
			var portrait: TextureRect
			if entry[0] == "hat":
				var emoji := Widgets.label(column, value.get("emoji", "—"), 25)
				emoji.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			else:
				portrait = TextureRect.new()
				portrait.material = MarketViewportComposite.create()
				portrait.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
				portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
				portrait.custom_minimum_size.y = 74 if entry[0] == "body" else 30
				portrait.mouse_filter = Control.MOUSE_FILTER_IGNORE
				column.add_child(portrait)
			var label := Widgets.label(column, value.name, 11)
			label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			label.mouse_filter = Control.MOUSE_FILTER_IGNORE
			if entry[0] == "body":
				var description := Widgets.label(column, value.description, 9)
				description.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				description.mouse_filter = Control.MOUSE_FILTER_IGNORE
			button.pressed.connect(func():
				var changes := {entry[0]: value.id}
				if entry[0] == "hair": changes.hat = "none"
				_change_avatar(changes))
			avatar_choices.append({"key": entry[0], "id": value.id, "button": button, "portrait": portrait})
	_refresh_avatar_choices(avatar)
	for key in ["hairColor"]:
		Widgets.label(options, {"skin": "Piel", "shirt": "Camiseta", "hairColor": "Color de pelo"}[key])
		var color := ColorPickerButton.new()
		color.mouse_filter = Control.MOUSE_FILTER_PASS
		color.custom_minimum_size.y = 44
		color.edit_alpha = false
		color.color = Color(avatar[key])
		color.color_changed.connect(func(value: Color): _change_avatar({key: "#" + value.to_html(false)}))
		options.add_child(color)

func _change_avatar(changes: Dictionary) -> void:
	if panel == "setup": setup_avatar.merge(changes, true)
	else:
		var action := changes.duplicate()
		action.type = "SET_AVATAR"
		store.dispatch(action)
	if is_instance_valid(avatar_preview): avatar_preview.update_avatar(setup_avatar if panel == "setup" else store.game.avatar)
	_refresh_avatar_choices(setup_avatar if panel == "setup" else store.game.avatar)

func _refresh_avatar_choices(avatar: Dictionary) -> void:
	if not is_instance_valid(avatar_gallery): return
	for choice in avatar_choices:
		if not is_instance_valid(choice.button): continue
		choice.button.set_pressed_no_signal(avatar[choice.key] == choice.id)
		if choice.portrait == null: continue
		var candidate := avatar.duplicate(true)
		candidate[choice.key] = choice.id
		if choice.key == "hair": candidate.hat = "none"
		var framing := "head" if choice.key == "hair" else "body"
		var portrait_key := framing + JSON.stringify(candidate)
		choice.portrait.set_meta("portrait_key", portrait_key)
		avatar_gallery.request(portrait_key, candidate, framing, func(texture: Texture2D):
			if is_instance_valid(choice.portrait) and choice.portrait.get_meta("portrait_key") == portrait_key: choice.portrait.texture = texture)

func _panel_state_key() -> String:
	if store.game == null: return ""
	var game: Dictionary = store.game
	var franchise := Progression.current_franchise(game)
	match panel:
		"stock": return JSON.stringify([franchise.warehouse, franchise.shelves])
		"orders": return JSON.stringify([game.level, game.progression, game.pendingOrders, franchise.carry, franchise.warehouse, franchise.get("purchases"), franchise.unlockedAreas])
		"team": return JSON.stringify([game.balanceMinor, RosterUpgrades.roster_entries(franchise, Game.country_money_scale(game.countryCode))])
		"map": return JSON.stringify([game.balanceMinor, game.level, game.currentFranchiseId, game.franchises.map(func(item): return [item.owned, item.rating, item.employees.size(), CampaignExpansion.campaign_expansion_quote(game, item.id)])])
		"finance": return JSON.stringify([game.balanceMinor, game.finances])
	return ""

func _refresh_panel() -> void:
	panel_refresh_pending = false
	if panel not in ["stock", "orders", "team", "map", "finance"] or overlay == null: return
	var scroll := panel_scroll.scroll_vertical
	Widgets.clear(panel_content)
	_fill_panel()
	panel_scroll.set_deferred("scroll_vertical", scroll)
