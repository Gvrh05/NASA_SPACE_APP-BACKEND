import { PlatformService } from './platform.service'
import { resolve } from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common'

describe('Memories privacy & management', () => {
  let service: PlatformService
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'helios-mem-'))
    process.env.SIMULATION_DATA_DIR = dir
    service = new PlatformService()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows a crew member to create a memory with photo and text', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const dummyBase64 = Buffer.from('fake-jpeg-data').toString('base64')
    const memory = service.createMemory(mateo, {
      title: 'Family at Cape Canaveral',
      message: 'Looking back at our last launch day before the mission.',
      imageBase64: `data:image/jpeg;base64,${dummyBase64}`,
      imageContentType: 'image/jpeg',
    })

    expect(memory.id).toBeTruthy()
    expect(memory.profileId).toBe('mateo-ruiz')
    expect(memory.title).toBe('Family at Cape Canaveral')
    expect(memory.message).toContain('last launch day')
    expect(memory.imageFileId).toBeTruthy()

    // Can fetch image buffer
    const img = service.getMemoryImage(mateo, memory.id)
    expect(img.contentType).toBe('image/jpeg')
    expect(img.buffer.toString()).toBe('fake-jpeg-data')

    // Physically stored in user's isolated private folder
    const userFilePath = resolve(dir, 'memories', 'mateo-ruiz', memory.imageFileId!)
    expect(existsSync(userFilePath)).toBe(true)
  })

  it('allows creating a memory with text only', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const memory = service.createMemory(mateo, {
      title: 'A quiet morning',
      message: 'Remembering the sunrise over the mountains back home.',
    })

    expect(memory.title).toBe('A quiet morning')
    expect(memory.imageFileId).toBeNull()
    expect(memory.imageContentType).toBeNull()
  })

  it('allows editing and deleting a memory and removes associated file', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const dummyBase64 = Buffer.from('img-bytes').toString('base64')
    const memory = service.createMemory(mateo, {
      title: 'My pet',
      message: 'Luna playing in the grass.',
      imageBase64: dummyBase64,
      imageContentType: 'image/png',
    })

    const updated = service.updateMemory(mateo, memory.id, {
      title: 'Luna at sunset',
      message: 'Always running through the backyard.',
    })
    expect(updated.title).toBe('Luna at sunset')
    expect(updated.message).toContain('Always running')

    const userFilePath = resolve(dir, 'memories', 'mateo-ruiz', memory.imageFileId!)
    expect(existsSync(userFilePath)).toBe(true)

    // Deleting
    const res = service.deleteMemory(mateo, memory.id)
    expect(res.ok).toBe(true)

    // File is removed from user directory
    expect(existsSync(userFilePath)).toBe(false)

    // Cannot get anymore
    expect(() => service.getMemory(mateo, memory.id)).toThrow(NotFoundException)
    expect(() => service.getMemoryImage(mateo, memory.id)).toThrow(NotFoundException)
  })

  it('enforces privacy: Chief, Medic, and Psychologist CANNOT access Crew memories', () => {
    const chief = service.requireSession(service.selectProfile('elena-torres').token)
    const crew = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const medic = service.requireSession(service.selectProfile('sofia-chen').token)
    const psych = service.requireSession(service.selectProfile('alex-morgan').token)

    const dummyBase64 = Buffer.from('private-crew-image').toString('base64')
    const memory = service.createMemory(crew, {
      title: 'Private Crew Memory',
      message: 'Personal letter from my partner.',
      imageBase64: dummyBase64,
      imageContentType: 'image/jpeg',
    })

    // Chief listing does not see crew memory
    const chiefList = service.listMemories(chief)
    expect(chiefList.some((m) => m.id === memory.id)).toBe(false)

    // Chief direct access is forbidden
    expect(() => service.getMemory(chief, memory.id)).toThrow(ForbiddenException)
    expect(() => service.getMemoryImage(chief, memory.id)).toThrow(ForbiddenException)
    expect(() => service.updateMemory(chief, memory.id, { title: 'Hacked' })).toThrow(ForbiddenException)
    expect(() => service.deleteMemory(chief, memory.id)).toThrow(ForbiddenException)

    // Medic direct access is forbidden
    expect(() => service.getMemory(medic, memory.id)).toThrow(ForbiddenException)
    expect(() => service.getMemoryImage(medic, memory.id)).toThrow(ForbiddenException)

    // Psychologist direct access is forbidden
    expect(() => service.getMemory(psych, memory.id)).toThrow(ForbiddenException)
    expect(() => service.getMemoryImage(psych, memory.id)).toThrow(ForbiddenException)
  })

  it('validates title and message constraints', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)

    // Missing title
    expect(() => service.createMemory(mateo, { title: '   ', message: 'Hi' })).toThrow(BadRequestException)

    // Message truncated to 500 chars if exceeded
    const longMsg = 'a'.repeat(600)
    const memory = service.createMemory(mateo, { title: 'Valid title', message: longMsg })
    expect(memory.message.length).toBe(500)
  })

  it('preserves memories across missions and role views', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    service.createMemory(mateo, { title: 'Lifelong memory', message: 'Always with me' })

    const list = service.listMemories(mateo)
    expect(list.length).toBe(1)
    expect(list[0].title).toBe('Lifelong memory')
  })

  it('initializes Quirón emotional care conversation with correct welcome text', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    // horizon mission is in flight (aboard)
    const convEn = service.startConversation(mateo, 'mission-demo-horizon', 'emotional', 'en')
    expect(convEn.messages[0].text).toBe(
      'Would you like to talk about how you’re feeling, or get help requesting an appointment?'
    )

    const convEs = service.startConversation(mateo, 'mission-demo-horizon', 'emotional', 'es')
    expect(convEs.messages[0].text).toContain(
      '¿Te gustaría hablar sobre cómo te sientes o recibir ayuda para solicitar una cita?'
    )
  })
})
