extends TestCase
var recovery: RecoveryStorage
var directory: String

func before_each() -> void:
	directory = "user://test-recovery-timing-" + JS.uuid()
	recovery = RecoveryStorage.new()
	recovery.directory = directory
	Engine.get_main_loop().root.add_child(recovery)

func after_each() -> void:
	recovery.free()
	var dir := DirAccess.open(directory)
	if dir != null:
		for file in dir.get_files(): dir.remove(file)
		DirAccess.remove_absolute(directory)

## Backs the reported recoveryPersistMaxMs/recoveryPersistOverThresholdCount
## fields folded into client_telemetry's one-minute-window report, used to
## confirm or rule out the every-3-second recovery write (persist_recovery_snapshot)
## as a source of in-game hitches while playing.
func test_take_persist_stats_aggregates_and_resets() -> void:
	var empty := recovery.take_persist_stats()
	assert_eq(empty.recoveryPersistCount, 0)
	recovery.persist_recovery_snapshot({"state": {"revision": 1}, "saveRevision": 1, "pendingEvents": []})
	recovery.persist_recovery_snapshot({"state": {"revision": 2}, "saveRevision": 1, "pendingEvents": []})
	var stats := recovery.take_persist_stats()
	assert_eq(stats.recoveryPersistCount, 2)
	assert_gte(stats.recoveryPersistMaxMs, 0)
	assert_true(stats.has("recoveryPersistDuplicateMs"))
	assert_true(stats.has("recoveryPersistStringifyMs"))
	assert_true(stats.has("recoveryPersistWriteMs"))
	var drained := recovery.take_persist_stats()
	assert_eq(drained.recoveryPersistCount, 0)
	assert_eq(drained.recoveryPersistMaxMs, 0)
	assert_false(drained.has("recoveryPersistDuplicateMs"))

func test_flags_a_persist_slower_than_the_stall_threshold() -> void:
	var big := {}
	for index in 200000: big[str(index)] = "padding-value-%d" % index
	recovery.persist_recovery_snapshot({"state": {"revision": 1, "payload": big}, "saveRevision": 1, "pendingEvents": []})
	var stats := recovery.take_persist_stats()
	assert_eq(stats.recoveryPersistCount, 1)
	if stats.recoveryPersistMaxMs >= RecoveryStorage.PERSIST_STALL_THRESHOLD_MS:
		assert_eq(stats.recoveryPersistOverThresholdCount, 1)
