// Scene3D 轨迹领域纯函数——现仅剩两个「跨钩子共享」的读取/清理函数：
//   · removeTrajectoryBindingsForNode —— useScene3DFullscreenActions 删节点时解绑其轨迹
//   · trajectoryBindTargetsFromState  —— useScene3DTrajectoryEditing 列出可绑定的目标
// 其余轨迹编辑纯函数原本只服务已删除的 useScene3DTrajectoryEditor（死钩子），随之一并移除。
// 注：活钩子 useScene3DTrajectoryEditing 目前内联了自己的等价实现（P1 待收敛：
// 真正根治是让活钩子改用共享纯函数，但那需改动活钩子，超出本次死码清理范围）。
import type { Scene3DState } from './scene3dTypes'
import { setScene3DObjectRuntimeRefsVisible } from './trajectory/trajectoryRuntimeStore'
import type { TrajectoryBindTarget } from './trajectory/trajectoryRendererShared'

export function removeTrajectoryBindingsForNode(state: Scene3DState, objectId: string): Scene3DState {
  let changed = false
  const trajectoryBindings = state.trajectoryBindings.flatMap((binding) => {
    const hadObject = binding.objects.some((object) => object.objectId === objectId)
    if (!hadObject) return [binding]
    changed = true
    setScene3DObjectRuntimeRefsVisible(objectId, true)
    const objects = binding.objects.filter((object) => object.objectId !== objectId)
    return objects.length > 0 ? [{ ...binding, objects }] : []
  })

  if (!changed) return state
  return {
    ...state,
    trajectoryBindings,
  }
}

export function trajectoryBindTargetsFromState(state: Scene3DState): TrajectoryBindTarget[] {
  const boundObjectIds = new Set(
    state.trajectoryBindings.flatMap((binding) => binding.objects.map((object) => object.objectId)),
  )
  return [
    ...state.objects
      .filter((object) => (
        (object.type === 'mannequin' || object.type === 'mannequinCrowd') &&
        !boundObjectIds.has(object.id)
      ))
      .map((object) => ({
        id: object.id,
        name: object.name,
        type: 'mannequin' as const,
      })),
    ...state.cameras
      .filter((camera) => !boundObjectIds.has(camera.id))
      .map((camera) => ({
        id: camera.id,
        name: camera.name,
        type: 'camera' as const,
      })),
  ]
}
