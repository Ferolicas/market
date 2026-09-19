class_name Locomotion
extends RefCounted
## Port of src/game/locomotion.ts. Points are `[x, z]` Arrays.
## VisitorPose: { animation, position, target, visible }.
## VisitorRoute: { browse, queue, enterVia, queueVia }.

const FULL_TURN = PI * 2

static func frame_delta(delta: float) -> float:
	return minf(maxf(delta, 0.0), 0.05)

static func damp_factor(response: float, delta: float) -> float:
	return 1 - exp(-response * frame_delta(delta))

static func turn_towards(current: float, target: float, max_step: float) -> float:
	var difference := fmod(fmod(target - current + PI, FULL_TURN) + FULL_TURN, FULL_TURN) - PI
	if absf(difference) <= max_step: return target
	return current + JS.sign_of(difference) * max_step

static func travel_progress(progress: float, ramp: float = 0.14) -> float:
	var value := minf(1.0, maxf(0.0, progress))
	var edge := minf(0.45, maxf(0.02, ramp))
	var area := 1 - edge
	if value < edge: return (value * value) / (2 * edge * area)
	if value > 1 - edge:
		var remaining := 1 - value
		return 1 - (remaining * remaining) / (2 * edge * area)
	return (value - edge / 2) / area

## VisitorAnimation: "Idle" | "Walk" | "Run" | "Enter" | "Wait" | "Browse" |
## "ReachShelf" | "CarryBasket" | "BasketWalk" | "Queue" | "LookAround" |
## "Phone" | "Impatient" | "Talk" | "CheckoutItem" | "Pay" | "ReceiveBag" |
## "Confused" | "Happy" | "Exit"

static var VISITOR_ROUTES: Dictionary = {
	# The three pantry gondolas stand side by side at z = 0.25 (x −3.5…2.5), so
	# every visitor heading south uses the aisle east of them (x ≈ 3.1) and
	# passes below the row at z ≈ −1 before turning west; the drinks display
	# now starts at z −2.16, east of that aisle.
	1: { "browse": [-4.55, 0.39], "queue": CheckoutLayout.checkout_queue_position(0), "enterVia": [[0.8, 5.3], [3.1, 5.3], [3.1, -1.0], [-4.55, -1.0]], "queueVia": [[-4.55, -1.0], [3.1, -1.0], [3.1, 2.07], [7, 2.07]] },
	2: { "browse": [-0.5, 1.65], "queue": CheckoutLayout.checkout_queue_position(1), "enterVia": [[-0.5, 5.6]], "queueVia": [[4.7, 2.07], [5.35, 2.75]] },
	3: { "browse": [5.45, -3.1], "queue": CheckoutLayout.checkout_queue_position(2), "enterVia": [[0.8, 5.3], [3.1, 5.3], [3.1, -1.0], [5.45, -1.0]], "queueVia": [[5.45, -1.0], [5.35, 0.8]] },
	4: { "browse": [-4.0, 4.15], "queue": CheckoutLayout.checkout_queue_position(3), "enterVia": [[-2.2, 5.6]], "queueVia": [[5.35, 4.15]] },
	5: { "browse": [0, 4.4], "queue": CheckoutLayout.checkout_queue_position(4), "enterVia": [[0, 5.6]], "queueVia": [[5.35, 4.4]] },
	6: { "browse": [4.0, 4.15], "queue": CheckoutLayout.checkout_queue_position(5), "enterVia": [[1.5, 5.6]], "queueVia": [[5.35, 4.15]] },
}

static var CUSTOMER_CHECKOUT: Array = [CheckoutLayout.CHECKOUT_LANES[0].customerFront[0], CheckoutLayout.CHECKOUT_LANES[0].customerFront[1]]
static var CUSTOMER_CHECKOUT_APPROACH: Array = CheckoutLayout.checkout_queue_arrival(0, 0)[0]
static var CUSTOMER_QUEUE_CORNER: Array = [CheckoutLayout.CHECKOUT_LANES[0].queueStart[0], CUSTOMER_CHECKOUT_APPROACH[1]]

static func sample_visitor_journey(time: float, entry_x: float, route: Dictionary, confused: bool = false) -> Dictionary:
	var browse: Array = route.browse
	var queue: Array = route.queue
	var animation := "Idle"
	var position: Array = [entry_x, 5.25]
	var target: Array = [entry_x, 4.25]

	if time < 7:
		var progress := travel_progress(time / 7)
		var path: Array = [[entry_x, 15.2]] + route.enterVia + [browse]
		position = _mix_path(path, progress)
		target = _mix_path(path, minf(1.0, progress + 0.025))
		animation = "Enter"
	elif time < 13:
		position = browse
		target = [browse[0] + (-1 if entry_x < 0 else 1), browse[1]]
		animation = "Browse"
	elif time < 17:
		position = browse
		target = [browse[0] + (-1 if entry_x < 0 else 1), browse[1]]
		animation = "ReachShelf"
	elif time < 25:
		var progress := travel_progress((time - 17) / 8)
		var path: Array = [browse] + route.queueVia + [queue]
		position = _mix_path(path, progress)
		target = _mix_path(path, minf(1.0, progress + 0.025))
		animation = "Walk" if progress < 0.35 else "BasketWalk"
	elif time < 29:
		position = queue
		target = [7.45, 3.95]
		animation = "Confused" if confused else "Queue"
	elif time < 30.5:
		var progress := travel_progress((time - 29) / 1.5, 0.2)
		var checkout_path: Array
		if JS.hypot(queue[0] - CUSTOMER_CHECKOUT[0], queue[1] - CUSTOMER_CHECKOUT[1]) < 0.05:
			checkout_path = [queue, CUSTOMER_CHECKOUT]
		else:
			checkout_path = [queue, CUSTOMER_QUEUE_CORNER, CUSTOMER_CHECKOUT_APPROACH, CUSTOMER_CHECKOUT]
		position = _mix_path(checkout_path, progress)
		target = CUSTOMER_CHECKOUT
		animation = "CarryBasket"
	elif time < 33:
		position = CUSTOMER_CHECKOUT
		target = [7.55, 3.95]
		animation = "CheckoutItem"
	elif time < 35:
		position = CUSTOMER_CHECKOUT
		target = [7.55, 3.95]
		animation = "Pay"
	elif time < 37:
		position = CUSTOMER_CHECKOUT
		target = [7.55, 3.95]
		animation = "ReceiveBag"
	elif time < 41:
		var progress := travel_progress((time - 37) / 4)
		var exit_path: Array = [CUSTOMER_CHECKOUT, [5.35, 2.85], [5.35, 5.6], [entry_x, 5.6], [entry_x, 8.65]]
		position = _mix_path(exit_path, progress)
		target = _mix_path(exit_path, minf(1.0, progress + 0.025))
		animation = "Exit"
	else:
		var progress := travel_progress((time - 41) / 6)
		position = [entry_x, _mix(8.65, 15.4, progress)]
		target = [entry_x, 16]
		animation = "Exit"

	return { "animation": animation, "position": position, "target": target, "visible": time < 47.5 }

static func _mix(start: float, end: float, progress: float) -> float:
	return start + (end - start) * progress

static func _mix_point(start: Array, end: Array, progress: float) -> Array:
	return [_mix(start[0], end[0], progress), _mix(start[1], end[1], progress)]

static func _mix_path(points: Array, progress: float) -> Array:
	if points.size() < 2: return points[0] if points.size() > 0 else [0, 0]
	var lengths := []
	for index in range(1, points.size()):
		lengths.append(JS.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
	var total: float = JS.sum(lengths)
	var distance := minf(1.0, maxf(0.0, progress)) * total
	for index in lengths.size():
		if distance <= lengths[index] or index == lengths.size() - 1:
			return _mix_point(points[index], points[index + 1], distance / lengths[index] if lengths[index] else 1.0)
		distance -= lengths[index]
	var last = JS.at(points, -1)
	return last if last != null else [0, 0]
