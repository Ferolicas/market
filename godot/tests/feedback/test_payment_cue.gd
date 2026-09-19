extends TestCase

func test_cuenta_los_clientes_que_pagaron_en_la_tienda_visitada() -> void:
	assert_eq(PaymentCue.new_customer_payments({ "franchiseId": "madrid", "customersToday": 4 }, { "franchiseId": "madrid", "customersToday": 6 }), 2)

func test_no_suena_al_cargar_al_viajar_ni_cuando_el_nuevo_dia_pone_el_contador_a_cero() -> void:
	assert_eq(PaymentCue.new_customer_payments(null, { "franchiseId": "madrid", "customersToday": 9 }), 0)
	assert_eq(PaymentCue.new_customer_payments({ "franchiseId": "madrid", "customersToday": 2 }, { "franchiseId": "sevilla", "customersToday": 7 }), 0)
	assert_eq(PaymentCue.new_customer_payments({ "franchiseId": "madrid", "customersToday": 12 }, { "franchiseId": "madrid", "customersToday": 0 }), 0)
	assert_eq(PaymentCue.new_customer_payments({ "franchiseId": "madrid", "customersToday": 5 }, { "franchiseId": "madrid", "customersToday": 5 }), 0)
